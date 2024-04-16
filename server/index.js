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
	if (!process.env.SUPRESS_WEBHOOK_FORWARDING) {
		axios.request({
			method: 'post',
			url: 'https://https://mpg-calc.ngrok.io/webhooks/twilio',
			headers: {
				'Content-Type': 'application/json',
			},
			data: req.body,
		})
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
			"SELECT id FROM images WHERE class = 'pump' AND fueling_id IS NULL ORDER BY inserted_at desc LIMIT 1"
		)
		console.log(rows)
		if (rows.rows.length == 0) {
			// Note: insert new
			let result = await pool.query(
				'INSERT INTO images (class, mileage) VALUES ($1, $2)',
				['odometer', mileage]
			)
			console.log(result)
		} else {
			const [{ id: pump_image_id }] = rows.rows
			// TODO txn
			const fueling_id = crypto.randomUUID()
			let result = await pool.query(
				'INSERT INTO images (class, mileage, fueling_id) VALUES ($1, $2, $3)',
				['odometer', mileage, fueling_id]
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
			"SELECT id FROM images WHERE class = 'odometer' AND fueling_id IS NULL ORDER BY inserted_at desc LIMIT 1"
		)
		console.log(rows)
		if (rows.rows.length == 0) {
			// Note: insert new
			let result = await pool.query(
				'INSERT INTO images (class, gallons) VALUES ($1, $2)',
				['pump', gallons]
			)
			console.log(result)
		} else {
			const [{ id: odometer_image_id }] = rows.rows
			// TODO txn
			const fueling_id = crypto.randomUUID()
			let result = await pool.query(
				'INSERT INTO images (class, gallons, fueling_id) VALUES ($1, $2, $3)',
				['pump', gallons, fueling_id]
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

app.listen(PORT, (err) => {
	if (err) {
		throw err
	}
	console.log('listening on ' + PORT)
})
