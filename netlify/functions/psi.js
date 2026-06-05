exports.handler = async function (event) {
  // Só aceita GET
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const siteUrl = event.queryStringParameters?.url;
  if (!siteUrl) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Parâmetro url é obrigatório' }),
    };
  }

  // Valida URL
  try { new URL(siteUrl); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'URL inválida' }) };
  }

  // Chave fica SOMENTE na variável de ambiente do Netlify — nunca no código
  const apiKey = process.env.PSI_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'PSI_API_KEY não configurada' }) };
  }

  const psiUrl =
    `https://www.googleapis.com/pagespeedonline/v5/runPagespeed` +
    `?url=${encodeURIComponent(siteUrl)}` +
    `&strategy=mobile` +
    `&category=performance` +
    `&key=${apiKey}`;

  try {
    const res = await fetch(psiUrl);
    const data = await res.json();

    if (!res.ok) {
      return {
        statusCode: res.status,
        body: JSON.stringify({ error: data?.error?.message || 'Erro PSI' }),
      };
    }

    // Extrai só o que a calculadora precisa — não expõe o JSON inteiro
    const metrics = data?.loadingExperience?.metrics || {};
    const lab     = data?.lighthouseResult?.audits  || {};
    const source  = Object.keys(metrics).length > 0 ? 'field' : 'lab';

    const lcp =
      metrics.LARGEST_CONTENTFUL_PAINT_MS?.percentile != null
        ? metrics.LARGEST_CONTENTFUL_PAINT_MS.percentile / 1000
        : lab['largest-contentful-paint']?.numericValue != null
          ? lab['largest-contentful-paint'].numericValue / 1000
          : null;

    const inp =
      metrics.INTERACTION_TO_NEXT_PAINT?.percentile != null
        ? metrics.INTERACTION_TO_NEXT_PAINT.percentile
        : lab['interaction-to-next-paint']?.numericValue != null
          ? lab['interaction-to-next-paint'].numericValue
          : null;

    const cls =
      metrics.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile != null
        ? metrics.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100
        : lab['cumulative-layout-shift']?.numericValue != null
          ? lab['cumulative-layout-shift'].numericValue
          : null;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*', // permite chamada do HTML estático
      },
      body: JSON.stringify({ lcp, inp, cls, source }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'Falha ao consultar PSI: ' + err.message }),
    };
  }
};
