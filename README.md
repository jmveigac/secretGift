# secretGift

## Prerequisites
If you want to run, you need the next __.env__ configuration:

```js
FROM='"Name From" <mail@mail.es>'
HOST='smtp.host.com'
PORT='000'
MAILUSER='mail@mail.es'
MAILPWD='password'
SUBJECT='Subject'
TESTMAIL='testmail@mail.com'
```
If you want to read from json you need to create __participants.json__ with the following data:

```json
[
    {
        "name": "name1",
        "email": "name1@mail.com",
        "lastGift": "name3"
    },
    {
        "name": "name2",
        "email": "name2@mail.com",
        "lastGift": "name1"
    },
    {
        "name": "name3",
        "email": "name3@mail.com",
        "lastGift": "name2"
    },
    ...
]
```

And later encode in base64:
```
WwogICAgewogICAgICAgICJuYW1lIjogIm5hbWUxIiwKICAgICAgICAiZW1haWwiOiAibmFtZTFAbWFpbC5jb20iLAogICAgICAgICJsYXN0R2lmdCI6ICJuYW1lMyIKICAgIH0sCiAgICB7CiAgICAgICAgIm5hbWUiOiAibmFtZTIiLAogICAgICAgICJlbWFpbCI6ICJuYW1lMkBtYWlsLmNvbSIsCiAgICAgICAgImxhc3RHaWZ0IjogIm5hbWUxIgogICAgfSwKICAgIHsKICAgICAgICAibmFtZSI6ICJuYW1lMyIsCiAgICAgICAgImVtYWlsIjogIm5hbWUzQG1haWwuY29tIiwKICAgICAgICAibGFzdEdpZnQiOiAibmFtZTIiCiAgICB9Cl0=
```

To remind a draw, you need a json in base64 called newParticipants.json

## To run the code
```bash
$ npm i
$ npm start
```

## To check the code
```bash
$ npm run build-check
```