# guess-the-name

A two-player word game. One player picks a category and enters an answer plus a sequence of hints; the other tries to guess. Roles alternate each round.

## Run it locally

```bash
npm install
npm start
```

Then open `http://localhost:3000`.

## How a round works

1. Create a room — you get a 6-character code to share.
2. The hinter picks a category, enters an answer, and writes hints.
3. Hints are revealed one at a time to the guesser.
4. Roles swap each round.

## Tech stack

- **Server:** Node.js, Express, Socket.IO
- **Client:** vanilla JS in `public/`