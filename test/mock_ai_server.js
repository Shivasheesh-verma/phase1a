import http from 'node:http';

let estimationCallCount = 0;

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/stats') {
    return json(res, 200, { estimation_call_count: estimationCallCount });
  }

  if (req.method === 'POST' && req.url === '/reset') {
    estimationCallCount = 0;
    return json(res, 200, { estimation_call_count: estimationCallCount });
  }

  if (req.method === 'POST' && req.url === '/chat/completions') {
    estimationCallCount += 1;
    const body = await readBody(req);
    const userMessage = body?.messages?.find((message) => message.role === 'user')?.content;
    const parsed = safeParse(userMessage);
    const misses = Array.isArray(parsed?.misses) ? parsed.misses : [];

    const items = misses
      .filter((miss) => typeof miss === 'string' && miss.toLowerCase().includes('chicken biryani'))
      .map((miss) => ({
        input: miss,
        name: 'chicken biryani',
        qty: 1,
        unit: 'plate',
        est_grams: 450,
        cal: 620,
        protein: 32,
        carb: 72,
        fat: 20,
        fibre: 4,
        confidence: 'medium',
        margin_note: 'restaurant portions vary',
        save_as_preset: true,
        preset: {
          name: 'chicken biryani',
          aliases: ['chicken biryani', 'biryani'],
          basis_qty: 1,
          basis_unit: 'plate',
          cal: 620,
          protein: 32,
          carb: 72,
          fat: 20,
          fibre: 4,
        },
      }));

    const content = `\`\`\`json\n${JSON.stringify({ items }, null, 2)}\n\`\`\``;
    return json(res, 200, {
      choices: [
        {
          message: {
            content,
          },
        },
      ],
    });
  }

  return json(res, 404, { error: 'not_found' });
});

server.listen(4010, '127.0.0.1', () => {
  console.log('Mock AI server listening on http://127.0.0.1:4010');
});

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function safeParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      resolve(safeParse(raw));
    });
    req.on('error', reject);
  });
}
