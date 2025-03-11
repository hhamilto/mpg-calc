'use strict'
const axios = require('axios')

const OPENAI_API_KEY =
	process.env['OPENAI_API_KEY'] ||
	(() => {
		throw new Error('Missing OPENAI_API_KEY')
	})()

const PUMP = 'PUMP'
const ODOMETER = 'ODOMETER'

const classify = async (image_url) => {
	const DASHBOARD = 'DASHBOARD'
	const response = await axios.request({
		method: 'post',
		url: 'https://api.openai.com/v1/chat/completions',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${OPENAI_API_KEY}`,
		},
		data: {
			model: 'gpt-4o',
			messages: [
				{
					role: 'system',
					content:
						'You are part of a system to differentiate between pictures of gas pumps and pictures of a car dash. You should respond with a single word, either `OTHER`, `' +
						PUMP +
						'`, `' +
						DASHBOARD +
						'`',
				},
				{
					role: 'user',
					content: [
						{
							type: 'text',
							text: 'Is this an image of a gas pump or odometer?',
						},
						{
							type: 'image_url',
							image_url: {
								url: image_url,
							},
						},
					],
				},
			],
			max_tokens: 300,
		},
	})
	const content = response.data.choices[0].message.content
	if (PUMP == content) {
		return PUMP
	}
	if (DASHBOARD == content) {
		return ODOMETER
	}
	return 'OTHER'
}

const extractGallons = async (image_url) => {
	const response = await axios.request({
		method: 'post',
		url: 'https://api.openai.com/v1/chat/completions',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${OPENAI_API_KEY}`,
		},
		data: {
			model: 'gpt-4o',
			messages: [
				{
					role: 'system',
					content:
						'You are part of a system to read number of gallons dispensed from a gas pump display. You respond using only numbers indicating the number of gallons dispensed.',
				},
				{
					role: 'user',
					content: [
						{
							type: 'text',
							text: 'How many gallons dispensed?',
						},
						{
							type: 'image_url',
							image_url: {
								url: image_url,
							},
						},
					],
				},
			],
			max_tokens: 300,
		},
	})
	console.log(response.data.choices)
	const content = response.data.choices[0].message.content
	return Number(content.replace(/[^\d.]/g, ''))
}

// FIXME: Crop the image first for better accuracy
const extractMileage = async (image_url) => {
	const response = await axios.request({
		method: 'post',
		url: 'https://api.openai.com/v1/chat/completions',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${OPENAI_API_KEY}`,
		},
		data: {
			model: 'gpt-4o',
			messages: [
				{
					role: 'system',
					content:
						"You are part of a system to read the total mileage from a picture of a car's odometer. You respond using only the numbers on the odometer indicating the total mileage of the vehicle.",
				},
				{
					role: 'user',
					content: [
						{
							type: 'text',
							text: 'How many miles on the odometer?',
						},
						{
							type: 'image_url',
							image_url: {
								url: image_url,
							},
						},
					],
				},
			],
			max_tokens: 300,
		},
	})
	console.log(response.data.choices)
	const content = response.data.choices[0].message.content
	return Number(content.replace(/[^0-9.]/g, ''))
}

module.exports = {
	classify,
	extractGallons,
	extractMileage,
	PUMP,
	ODOMETER,
}
