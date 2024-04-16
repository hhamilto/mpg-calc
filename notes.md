- Am I near a gas station
- Am I stopped for long enough to gas up -- send notification
- Accept photos of 7 seg displays
- log raw data for analysis

- Idea: SMS/MMS version

A/ Set up backend
<!-- 	- Create user for database
	- Deploy node app
	- Express server that accepts file uploads
	- poke file into GCS
	- Send file to chat GPT
		- Figure out if its gas pump or odometer
		- Read number
	- Store reading in database
	- Database table
		- user_id, -->
	- come up with schema
	- set up twillio
	- write data to db
	- query api?
B/ Send photo to backend
C/ Query backend for mpg data and display in table





# Data model

T Images
- type: unknown, pump, odometer
- mileage
- gallons
- timestamps
- fueling id


Segments


json out:

[
	{start, end, length, gallons, mpg}
]


on image:
process to know type and number
assign fueling:
 - Date range query for last hour
 - if opposite type Image exists, assign both same fueling id


#
ngrok http --region=us --hostname=mpg-calc.ngrok.io 8080

<!--
app.post('/upload', (req, res) => {
	const bb = busboy({ headers: req.headers })
	bb.on('file', (name, file, info) => {
		const { filename, encoding, mimeType } = info
		let fileBuffer = null
		console.log(
			`File [${name}]: filename: %j, encoding: %j, mimeType: %j`,
			filename,
			encoding,
			mimeType
		)
		file.on('data', (data) => {
			if (!fileBuffer) {
				fileBuffer = data
				return
			}
			fileBuffer = Buffer.concat([fileBuffer, data])
		}).on('close', () => {
			const base64Image = fileBuffer.toString('base64')
			// lol
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
}) -->



fuk deploy this guy 😇

# Deploy steps

- run deploy script to tar and scp to server:
```
./scripts/deploy
```

- ssh into droplet
```
ssh root@143.198.190.93
```

- attach to tmux session
```
tmux a -t mpg-calc
```

- Kill the server, accept downtime

/- Set secrets in env vars

export DB_PASSWORD=
export TWILIO_API_TOKEN=
export OPENAI_API_KEY=

- rename old server directory
```
mv server server.old
```

- untar server.tgz
```
tar -zxvf server.tgz server/
```

- run migrations


- start new server
```
(cd server && npm start)
```

- YOU'RE DONE!

# Dumb database stuff

su - postgres
psql

CREATE DATABASE mpg_calc;

CREATE USER MPGCALC WITH PASSWORD '~put the p@ZZwrd here~';
GRANT ALL ON SCHEMA public TO mpgcalc;
