'use strict'
const express = require('express')
const busboy = require('busboy')
const axios = require('axios')
const pg = require('pg')

const pool = new pg.Pool({
	host: 'localhost',
	database: 'mpg_calc',
	user: 'mpgcalc',
	password: process.env['DB_PASSWORD'],
	max: 20,
	idleTimeoutMillis: 30000,
	connectionTimeoutMillis: 2000,
})

const imageExtractor = require('./image-extractor.js')

const PORT = 8002

const TWILIO_ACCOUNT_SID = 'AC826d0de709f5a8b8aabd6ecc1b7d1ec6'
const TWILIO_API_TOKEN = process.env['TWILIO_API_TOKEN']

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
	if (type == imageExtractor.ODOMETER) {
		console.log('classified as odometer')
		const mileage = await imageExtractor.extractMileage(image_url)
		console.log('mileage', mileage)
		// Check to see if there are any unbound pumps
		const rows = await pool.query(
			"SELECT id FROM images WHERE class = 'pump' AND fueling_id IS NULL AND phone_number = $1 ORDER BY inserted_at desc LIMIT 1",
			[req.body.From]
		)
		console.log(rows)
		if (rows.rows.length == 0) {
			// Note: insert new
			let result = await pool.query(
				'INSERT INTO images (class, mileage, phone_number) VALUES ($1, $2, $3)',
				['odometer', mileage, req.body.From]
			)
			console.log(result)
		} else {
			const [{ id: pump_image_id }] = rows.rows
			// TODO txn
			const fueling_id = crypto.randomUUID()
			let result = await pool.query(
				'INSERT INTO images (class, mileage, fueling_id, phone_number) VALUES ($1, $2, $3, $4)',
				['odometer', mileage, fueling_id, req.body.From]
			)
			console.log(result)

			result = await pool.query(
				'UPDATE images SET fueling_id = $1 WHERE id = $2',
				[fueling_id, pump_image_id]
			)
			console.log(result)
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
		}
	}
	res.status(200)
	res.setHeader('Content-Type', 'text/html')
	res.write(`
		<?xml version="1.0" encoding="UTF-8"?>
		<Response>
		    <Message>We got your message, thank you!</Message>
		</Response>`)
	res.end()
})

app.get('/:phoneNumber', async (req, res) => {
	console.log(req.params)
	// TODO: Pagination
	const rows = await getImagesForPhone(req.params.phoneNumber)
	if (rows.length == 0) {
		res.status(404)
		res.write('Unable to find mileage for ' + req.params.phoneNumber)
		res.end()
		return
	}
	// Step 1 group into fuelings
	const fuelingObj = {}
	for (const image of rows) {
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

	// Step 2 Calculate segments + mpg per segment
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

	let phoneNumberFormatted = rows[0].phone_number.substring(2)
	phoneNumberFormatted = formatPhoneNumber(phoneNumberFormatted)
	// Sorry
	res.header('Content-Type', 'text/html')

	res.write(`
		<html>
		<head>
		<title> Mileage for ${phoneNumberFormatted}</title>
		<script src="https://kit.fontawesome.com/8307bbcf03.js" crossorigin="anonymous"></script>
		<script src="https://cdn.tailwindcss.com"></script>
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		</head>
		<body>
		<div class="m-4">
			<h1 class="text-xl"> <span class="text-slate-900"> Mileage Report</span></h1>
			<i class="fa-solid fa-phone mr-1 text-slate-500"></i> ${phoneNumberFormatted}
		</div>
		<div class="flex flex-col m-4 mt-6" id="timeline">`)

	for (let i = 0; i < timeline.length; i++) {
		const event = timeline[i]
		if (i != 0) {
			res.write(`<div class="bg-slate-200 w-1 h-12 ml-1 ${i%2?'rounded-t':'rounded-b'}"></div>`)
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
			res.write(`<i class="fa-solid fa-gas-pump block text-slate-500"></i>`)
		} else if (event.type == 'segment') {
			res.write(`<i class="fa-solid fa-car pl-2 block text-slate-500"></i>`)
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
		`)

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
		'SELECT id, class, mileage, gallons, inserted_at, updated_at, fueling_id, phone_number FROM images WHERE phone_number = $1 AND fueling_id IS NOT NULL',
		['+' + phoneNumber]
	)
	if (rows.rows.length > 0) {
		return rows.rows
	}
	rows = await pool.query(
		'SELECT id, class, mileage, gallons, inserted_at, updated_at, fueling_id, phone_number FROM images WHERE phone_number = $1 AND fueling_id IS NOT NULL',
		['+1' + phoneNumber]
	)
	if (rows.rows.length > 0) {
		return rows.rows
	}
	return null
}

function formatPhoneNumber(phoneNumberString) {
  var cleaned = ('' + phoneNumberString).replace(/\D/g, '');
  var match = cleaned.match(/^(\d{3})(\d{3})(\d{4})$/);
  if (match) {
    return '(' + match[1] + ') ' + match[2] + '-' + match[3];
  }
  return null;
}
