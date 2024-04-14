const app = require('express')()
const busboy = require('busboy')

const PORT = 8080

app.get('/foo', (req, res) => {
	res.write('Hiiiii')
	res.end()
})

app.post('/upload', (req, res) => {
	const bb = busboy({ headers: req.headers })
	bb.on('file', (name, file, info) => {
		const { filename, encoding, mimeType } = info
		console.log(
			`File [${name}]: filename: %j, encoding: %j, mimeType: %j`,
			filename,
			encoding,
			mimeType
		)
		file.on('data', (data) => {
			console.log(`File [${name}] got ${data.length} bytes`)
		}).on('close', () => {
			console.log(`File [${name}] done`)
		})
	})
	bb.on('field', (name, val, info) => {
		console.log(`Field [${name}]: value: %j`, val)
	})
	bb.on('close', () => {
		console.log('Done parsing form!')
		res.writeHead(303, { Connection: 'close', Location: '/' })
		res.end()
	})
	req.pipe(bb)
	res.status(200)
	console.log('hi', req.headers)
	res.end()
})

app.listen(PORT, (err) => {
	if (err) {
		throw err
	}
	console.log('listening on ' + PORT)
})
