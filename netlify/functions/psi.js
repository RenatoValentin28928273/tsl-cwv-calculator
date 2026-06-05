const https = require('https');

function httpsPost(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch(e) { reject(new Error('JSON parse error: ' + raw.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const siteUrl = event.queryStringParameters?.url;
  if (!siteUrl) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Parâmetro url obrigatório' }) };
  }

  let parsedUrl;
  try { parsedUrl = new URL(siteUrl); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'URL inválida' }) };
  }

  const apiKey = process.env.PSI_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'PSI_API_KEY não configurada' }) };
  }

  const cruxUrl = `https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${apiKey}`;
  const cruxBody = {
    url: parsedUrl.origin + parsedUrl.pathname,
    formFactor: 'PHONE',
    metrics: [
      'largest_contentful_paint',
      'interaction_to_next_paint',
      'cumulative_layout_shift',
    ],
  };

  try {
    const { status, body: data } = await httpsPost(cruxUrl, cruxBody);

    if (status === 404) {
      const cruxBodyOrigin = { ...cruxBody, url: undefined, origin: parsedUrl.origin };
      const fallback = await httpsPost(cruxUrl, cruxBodyOrigin);

      if (fallback.status !== 200) {
        return {
          statusCode: 404,
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ error: 'Sem dados CrUX disponíveis para este domínio' }),
        };
      }
      return buildResponse(fallback.body, 'field-origin');
    }

    if (status !== 200) {
      return {
        statusCode: status,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: data?.error?.message || 'Erro CrUX' }),
      };
    }

    return buildResponse(data, 'field');

  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Falha: ' + err.message }),
    };
  }
};

function buildResponse(data, source) {
  const metrics = data?.record?.metrics || {};

  const lcp = metrics.largest_contentful_paint?.percentiles?.p75 != null
    ? metrics.largest_contentful_paint.percentiles.p75 / 1000
    : null;

  const inp = metrics.interaction_to_next_paint?.percentiles?.p75 != null
    ? metrics.interaction_to_next_paint.percentiles.p75
    : null;

  const cls = metrics.cumulative_layout_shift?.percentiles?.p75 != null
    ? parseFloat(metrics.cumulative_layout_shift.percentiles.p75)
    : null;

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({ lcp, inp, cls, source }),
  };
}
