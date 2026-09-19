// api/dashboard.js
// Función serverless de Vercel (Node.js runtime) que sincroniza el CSV
// publicado de Google Sheets, lo parsea y expone la información en JSON.
// La URL es pública (link "publicado en la web"), por lo que no requiere
// variables de entorno ni tokens de autenticación.

const CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vSxhN3lIz2Hvt72NylGnz1uJrS9IHyht5nwoVEb_16hC6YVJVoW9uRvHPZzlSsD0rbo7vUpH9nde-hg/pub?output=csv';

// Parsea una sola línea de CSV respetando comillas y comas dentro de campos
// entre comillas, incluyendo comillas escapadas ("").
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}

// Divide el texto CSV completo en líneas lógicas, uniendo líneas que
// quedaron partidas por saltos de línea dentro de un campo entre comillas.
function splitLogicalLines(text) {
  const rawLines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const lines = [];
  let buffer = '';

  for (const rawLine of rawLines) {
    buffer = buffer ? buffer + '\n' + rawLine : rawLine;
    const quoteCount = (buffer.match(/"/g) || []).length;
    if (quoteCount % 2 === 0) {
      lines.push(buffer);
      buffer = '';
    }
  }
  if (buffer) lines.push(buffer);

  return lines.filter((line) => line.trim().length > 0);
}

// Convierte un valor numérico en texto (posibles separadores de miles con
// coma) a un Number seguro. Devuelve 0 si no es un número válido.
function toNumber(value) {
  if (!value) return 0;
  const cleaned = String(value).trim().replace(/,/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Convierte el texto CSV completo en un arreglo de objetos, respetando el
// tipo de cada columna: Empresa, Razón Social, Cajas, Mes de Facturación,
// Ciudad, Tipo (en ese orden exacto).
function parseCSV(text) {
  const lines = splitLogicalLines(text);
  if (lines.length === 0) return [];

  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.every((v) => v.trim() === '')) continue;

    rows.push({
      empresa: (values[0] || '').trim(),
      razonSocial: (values[1] || '').trim(),
      cajas: toNumber(values[2]),
      mesFacturacion: toNumber(values[3]),
      ciudad: (values[4] || '').trim(),
      tipo: (values[5] || '').trim(),
    });
  }

  return rows;
}

module.exports = async (req, res) => {
  // Cabeceras CORS: se resuelven en el servidor para evitar el bloqueo de
  // CORS que produce el link publicado de Google Sheets si se consulta
  // directamente desde el navegador del cliente.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const response = await fetch(CSV_URL, { redirect: 'follow' });

    if (!response.ok) {
      throw new Error('No se pudo obtener el CSV. Código HTTP: ' + response.status);
    }

    const csvText = await response.text();
    const registros = parseCSV(csvText);
    const total = registros.reduce((sum, r) => sum + r.cajas, 0);

    res.status(200).json({
      success: true,
      syncedAt: new Date().toISOString(),
      total,
      registros,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      syncedAt: new Date().toISOString(),
      error: error && error.message ? error.message : 'Error desconocido al sincronizar con Google Sheets.',
    });
  }
};
