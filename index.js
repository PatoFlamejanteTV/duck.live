const fs = require('fs').promises;
const path = require('path');
const http = require('http');
const url = require('url');
const { Readable } = require('stream');

// Setup frames in memory
let original;
let flipped;

// Load frames asynchronously
(async () => {
  const framesPath = 'frames';
  const files = await fs.readdir(framesPath);

  original = await Promise.all(
    files.map(async (file) => {
      const frame = await fs.readFile(path.join(framesPath, file));
      return frame.toString();
    })
  );
  flipped = original.map((f) => f.split('').reverse().join(''));
})().catch((err) => {
  console.error('Error loading frames:', err);
});

const streamer = (stream, opts) => {
  let index = 0;
  const frames = opts.flip ? flipped : original;
  const frameCount = frames.length;
  const clearScreen = Buffer.from('\x1b[2J\x1b[3J\x1b[H');

  return setInterval(() => {
    stream.push(clearScreen);
    stream.push(frames[index]);
    index = (index + 1) % frameCount;
  }, 100);
};

const validateQuery = ({ flip }) => ({
  flip: String(flip).toLowerCase() === 'true',
});

const server = http.createServer((req, res) => {
  const { pathname, query } = url.parse(req.url, true);

  if (pathname === '/healthcheck') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('{"status":"ok"}');
  }

  if (
    req.headers['user-agent'] &&
    !req.headers['user-agent'].includes('curl')
  ) {
    res.writeHead(302, {
      Location: 'https://github.com/PatoFlamejanteTV/duck.live',
    });
    return res.end();
  }

  const stream = new Readable({ read() {} });
  stream.pipe(res);
  const interval = streamer(stream, validateQuery(query));

  req.on('close', () => {
    clearInterval(interval);
    stream.destroy();
  });
});

const port = process.env.PARROT_PORT || 3000;
server.listen(port, () => {
  console.log(`Listening on localhost:${port}`);
});
