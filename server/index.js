'use strict'
const express = require('express')
const busboy = require('busboy')
const axios = require('axios')
const pg = require('pg')

const imageExtractor = require('./image-extractor.js')

const PORT = 8002

const TWILIO_ACCOUNT_SID = 'AC826d0de709f5a8b8aabd6ecc1b7d1ec6'
const TWILIO_API_TOKEN =
	process.env['TWILIO_API_TOKEN'] ||
	(() => {
		throw new Error('Missing TWILIO_API_TOKEN')
	})()
const DB_PASSWORD =
	process.env['DB_PASSWORD'] ||
	(() => {
		throw new Error('Missing DB_PASSWORD')
	})()

const pool = new pg.Pool({
	host: 'localhost',
	database: 'mpg_calc',
	user: 'mpgcalc',
	password: DB_PASSWORD,
	max: 20,
	idleTimeoutMillis: 30000,
	connectionTimeoutMillis: 2000,
})

const app = express()

app.use(express.json())
app.use(express.urlencoded({ extended: false }))

app.get('/foo', (req, res) => {
	res.write('Hiiiii')
	res.end()
})

app.post('/webhooks/twilio', async (req, res) => {
	if (!process.env.SUPPRESS_WEBHOOK_FORWARDING) {
		axios
			.request({
				method: 'post',
				url: 'https://mpg-calc.ngrok.io/webhooks/twilio',
				headers: {
					'Content-Type': 'application/json',
				},
				data: req.body,
			})
			.catch((e) => console.log('webhook forwarding error'))
	}
	// XXX filter by mime type here for "security"
	console.log(req.body)
	const response = await axios.request({
		method: 'get',
		url: req.body.MediaUrl0,
		auth: {
			username: TWILIO_ACCOUNT_SID,
			password: TWILIO_API_TOKEN,
		},
		responseType: 'arraybuffer',
	})
	const base64Image = response.data.toString('base64')
	const image_url = `data:image/jpeg;base64,${base64Image}`

	const type = await imageExtractor.classify(image_url)
	let smsResponseMessageText = 'If you see this, something has gone wrong'
	if (type == imageExtractor.ODOMETER) {
		console.log('classified as odometer')
		let mileage = await imageExtractor.extractMileage(image_url)
		mileage = Math.floor(mileage)
		console.log('mileage', mileage)

		// Find the best matching car for this odometer reading
		const carId = await findBestMatchingCar(req.body.From, mileage)

		// Check to see if there are any unbound pumps
		const rows = await pool.query(
			"SELECT id FROM images WHERE class = 'pump' AND fueling_id IS NULL AND phone_number = $1 ORDER BY inserted_at desc LIMIT 1",
			[req.body.From]
		)
		console.log(rows)
		if (rows.rows.length == 0) {
			// Note: insert new
			let result = await pool.query(
				'INSERT INTO images (class, mileage, phone_number, car_id) VALUES ($1, $2, $3, $4)',
				['odometer', mileage, req.body.From, carId]
			)
			console.log(result)
			smsResponseMessageText =
				'Thanks for the odometer pic, send the pump!'
		} else {
			const [{ id: pump_image_id }] = rows.rows
			// TODO txn
			const fueling_id = crypto.randomUUID()
			let result = await pool.query(
				'INSERT INTO images (class, mileage, fueling_id, phone_number, car_id) VALUES ($1, $2, $3, $4, $5)',
				['odometer', mileage, fueling_id, req.body.From, carId]
			)
			console.log(result)

			result = await pool.query(
				'UPDATE images SET fueling_id = $1 WHERE id = $2',
				[fueling_id, pump_image_id]
			)
			console.log(result)
			smsResponseMessageText = `Matched odometer with the pump, view results at https://textmpg.com/${req.body.From}`
		}
	}

	if (type == imageExtractor.PUMP) {
		console.log('classified as pump')
		const gallons = await imageExtractor.extractGallons(image_url)
		console.log('gallons', gallons)
		// Check to see if there are any unbound odometers
		const rows = await pool.query(
			"SELECT id FROM images WHERE class = 'odometer' AND fueling_id IS NULL AND phone_number = $1 ORDER BY inserted_at desc LIMIT 1",
			[req.body.From]
		)
		console.log(rows)
		if (rows.rows.length == 0) {
			// Note: insert new
			let result = await pool.query(
				'INSERT INTO images (class, gallons, phone_number) VALUES ($1, $2, $3)',
				['pump', gallons, req.body.From]
			)
			console.log(result)
			smsResponseMessageText =
				'Thanks for the pump pic 😉 send the odometer!'
		} else {
			const [{ id: odometer_image_id }] = rows.rows
			// TODO txn
			const fueling_id = crypto.randomUUID()
			let result = await pool.query(
				'INSERT INTO images (class, gallons, fueling_id, phone_number) VALUES ($1, $2, $3, $4)',
				['pump', gallons, fueling_id, req.body.From]
			)
			console.log(result)

			result = await pool.query(
				'UPDATE images SET fueling_id = $1 WHERE id = $2',
				[fueling_id, odometer_image_id]
			)
			console.log(result)
			smsResponseMessageText = `Matched pump with the odometer, view results at https://textmpg.com/${req.body.From}`
		}
	}
	res.status(200)
	res.setHeader('Content-Type', 'text/html')
	res.write(`
		<?xml version="1.0" encoding="UTF-8"?>
		<Response>
		    <Message>${smsResponseMessageText}</Message>
		</Response>`)
	res.end()
})

app.get('/', async (req, res) => {
	// Sorry
	res.header('Content-Type', 'text/html')

	res.write(`
		<!DOCTYPE html>
		<html>
		<head>
		<title> Track your gas mileage easily</title>
		<script src="https://kit.fontawesome.com/8307bbcf03.js" crossorigin="anonymous"></script>
		<script src="https://cdn.tailwindcss.com"></script>
		<script defer src="https://unpkg.com/alpinejs@3.x.x/dist/cdn.min.js"></script>
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		</head>
		<body>
		<div class="m-4">
			<p>
				Track you gas mileage by texting pictures of your odometer and gas pump after you fill up!
			</p>
			<p>
				Text START to  (906) 256-6929 to begin.
			</p>
			<p>
				© 2025 textMPG
			</p>
		</div>
		</body>
		</html>`)
	res.end()
})

app.get('/:phoneNumber', async (req, res) => {
	let phoneNumber = req.params.phoneNumber || ''
	phoneNumber = phoneNumber.replace(/\D/g, '')
	if (phoneNumber == '') {
		res.status(404)
		res.write('Unable to find mileage, no phone number given')
		res.end()
		return
	}
	// TODO: Pagination
	const rows = await getImagesForPhone(phoneNumber)
	if (rows.length == 0) {
		res.status(404)
		res.write('Unable to find mileage for ' + req.params.phoneNumber)
		res.end()
		return
	}
	// Step 1: Group by car first
	const carGroups = {}
	for (const image of rows) {
		if (!carGroups[image.car_id]) {
			carGroups[image.car_id] = {
				carInfo: {
					id: image.car_id,
					make: image.make,
					model: image.model,
					year: image.year,
				},
				images: [],
			}
		}
		carGroups[image.car_id].images.push(image)
	}

	// Step 2: Process each car's timeline
	const cars = []
	for (const carGroup of Object.values(carGroups)) {
		// Group into fuelings for this car
		const fuelingObj = {}
		for (const image of carGroup.images) {
			if (!fuelingObj[image.fueling_id]) {
				fuelingObj[image.fueling_id] = []
			}
			fuelingObj[image.fueling_id].push(image)
		}
		const fuelings = Object.values(fuelingObj).map(([image1, image2]) => {
			return {
				mileage: image1.mileage || image2.mileage,
				gallons: image1.gallons || image2.gallons,
				type: 'fueling',
			}
		})
		fuelings.sort((f1, f2) => f1.mileage - f2.mileage)

		// Calculate segments + mpg per segment for this car
		const timeline = []
		for (let i = 0; i < fuelings.length; i++) {
			if (i == 0) {
				timeline.push(fuelings[i])
				continue
			}
			const distance = fuelings[i].mileage - fuelings[i - 1].mileage
			const gallons = fuelings[i].gallons
			const mpg = distance / gallons
			timeline.push({
				type: 'segment',
				mpg: mpg,
				distance: distance,
			})
			timeline.push(fuelings[i])
		}
		timeline.reverse()

		cars.push({
			...carGroup.carInfo,
			timeline: timeline,
		})
	}

	let phoneNumberFormatted = rows[0].phone_number.substring(2)
	phoneNumberFormatted = formatPhoneNumber(phoneNumberFormatted)
	// Sorry
	res.header('Content-Type', 'text/html')

	res.write(`
		<!DOCTYPE html>
		<html>
		<head>
		<title> Mileage for ${phoneNumberFormatted}</title>
		<script src="https://kit.fontawesome.com/8307bbcf03.js" crossorigin="anonymous"></script>
		<script src="https://cdn.tailwindcss.com"></script>
		<script defer src="https://unpkg.com/alpinejs@3.x.x/dist/cdn.min.js"></script>
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		</head>
		<body>
		<div class="m-4">
			<h1 class="text-xl"> <span class="text-slate-900"> Mileage Report</span></h1>
			<i class="fa-solid fa-phone mr-1 text-slate-500"></i> ${phoneNumberFormatted}
		</div>`)

	for (let carIndex = 0; carIndex < cars.length; carIndex++) {
		const car = cars[carIndex]
		const carName = [car.year, car.make, car.model]
			.filter(Boolean)
			.join(' ')

		res.write(`
		<div x-data="{ open: ${carIndex === 0 ? 'true' : 'false'} }" class="m-4 border border-slate-200 rounded-lg">
			<div class="bg-slate-50 p-4 cursor-pointer" @click="open = !open">
				<div class="flex items-center justify-between">
					<h2 class="text-lg font-medium">
						<i class="fa-solid fa-car mr-2 text-slate-600"></i>
						${carName || `Car ${car.id}`}
					</h2>
					<i class="fa-solid fa-chevron-down transform transition-transform" :class="{ 'rotate-180': open }"></i>
				</div>
			</div>
			<div x-show="open" x-transition class="p-4">
				<div class="flex flex-col" id="timeline-${car.id}">`)

		for (let i = 0; i < car.timeline.length; i++) {
			const event = car.timeline[i]
			if (i != 0) {
				res.write(
					`<div class="bg-slate-200 w-1 h-12 ml-1 ${i % 2 ? 'rounded-t' : 'rounded-b'}"></div>`
				)
			}
			res.write(`<div class="flex">`)
			if (event.type == 'segment') {
				res.write(`
				<div class="bg-slate-200 w-1 h-12 ml-1"></div>
				`)
			}

			res.write(`
				<div class="pr-2 flex items-center">`)

			if (event.type == 'fueling') {
				res.write(
					`<i class="fa-solid fa-gas-pump block text-slate-500"></i>`
				)
			} else if (event.type == 'segment') {
				res.write(
					`<i class="fa-solid fa-car pl-2 block text-slate-500"></i>`
				)
			}

			res.write(`
				</div><div>${capitalize(event.type)}<br/>`)
			if (event.type == 'fueling') {
				res.write(
					`<span class="text-slate-500">Gallons: ${event.gallons} &bull; Odo: ${numberWithCommas(event.mileage)}</span>`
				)
			} else if (event.type == 'segment') {
				res.write(
					`<span class="text-slate-500">MPG: ${Math.round(event.mpg * 10) / 10} &bull; Distance: ${event.distance} mi</span>`
				)
			}
			res.write(`</div>
				</div>`)
		}

		res.write(`
				</div>
			</div>
		</div>`)
	}

	res.write('</body></html>')
	res.end()
})

app.listen(PORT, (err) => {
	if (err) {
		throw err
	}
	console.log('listening on ' + PORT)
})

function capitalize(string) {
	return string.charAt(0).toUpperCase() + string.slice(1)
}

function numberWithCommas(x) {
	return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

const getImagesForPhone = async (phoneNumber) => {
	phoneNumber = phoneNumber.replace(/\D/g, '')
	let rows = await pool.query(
		`SELECT i.id, i.class, i.mileage, i.gallons, i.inserted_at, i.updated_at, i.fueling_id, i.phone_number, i.car_id,
		        c.make, c.model, c.year
		 FROM images i
		 INNER JOIN cars c ON i.car_id = c.id
		 WHERE i.phone_number = $1 AND i.fueling_id IS NOT NULL`,
		['+' + phoneNumber]
	)
	if (rows.rows.length > 0) {
		return rows.rows
	}
	rows = await pool.query(
		`SELECT i.id, i.class, i.mileage, i.gallons, i.inserted_at, i.updated_at, i.fueling_id, i.phone_number, i.car_id,
		        c.make, c.model, c.year
		 FROM images i
		 INNER JOIN cars c ON i.car_id = c.id
		 WHERE i.phone_number = $1 AND i.fueling_id IS NOT NULL`,
		['+1' + phoneNumber]
	)
	if (rows.rows.length > 0) {
		return rows.rows
	}
	return []
}

function formatPhoneNumber(phoneNumberString) {
	var cleaned = ('' + phoneNumberString).replace(/\D/g, '')
	var match = cleaned.match(/^(\d{3})(\d{3})(\d{4})$/)
	if (match) {
		return '(' + match[1] + ') ' + match[2] + '-' + match[3]
	}
	return null
}

async function findBestMatchingCar(phoneNumber, newMileage) {
	// Get all cars for this phone number
	const carsResult = await pool.query(
		'SELECT id FROM cars WHERE phone_number = $1',
		[phoneNumber]
	)

	if (carsResult.rows.length === 0) {
		throw new Error('No cars found for this phone number')
	}

	if (carsResult.rows.length === 1) {
		return carsResult.rows[0].id
	}

	// Get the most recent odometer reading for each car
	const carDistances = []
	for (const car of carsResult.rows) {
		const lastOdometerResult = await pool.query(
			'SELECT mileage FROM images WHERE phone_number = $1 AND car_id = $2 AND class = $3 ORDER BY inserted_at DESC LIMIT 1',
			[phoneNumber, car.id, 'odometer']
		)

		if (lastOdometerResult.rows.length > 0) {
			const lastMileage = lastOdometerResult.rows[0].mileage
			const distance = Math.abs(newMileage - lastMileage)
			carDistances.push({ carId: car.id, distance, lastMileage })
		}
	}

	if (carDistances.length === 0) {
		// No previous odometer readings, use first car
		return carsResult.rows[0].id
	}

	// Find the car with the smallest distance
	carDistances.sort((a, b) => a.distance - b.distance)
	const closestCar = carDistances[0]

	// Error if the closest car is more than 1000 miles away
	if (closestCar.distance > 1000) {
		throw new Error(
			`New odometer reading ${newMileage} is ${closestCar.distance} miles away from closest car's last reading of ${closestCar.lastMileage}. Maximum allowed distance is 1000 miles.`
		)
	}

	return closestCar.carId
}
