const DRIVE_JSON_NAME = 'MSTY_v3.1.1_latest.json';
const DRIVE_ZIP_NAME = 'MSTY_v3.1.1_latest.zip';
const LEGACY_JSON_NAME = 'MSTY_PROJECT1000_latest.json';
const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';

async function driveFetch(url, token, options={}) {
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.headers||{}) }
  });
  if (!response.ok) {
    const text = await response.text().catch(()=> '');
    throw new Error(`Drive API ${response.status}: ${text}`);
  }
  return response;
}

async function findFile(token, name) {
  const q = encodeURIComponent(`name='${name}' and trashed=false`);
  const fields = encodeURIComponent('files(id,name,modifiedTime)');
  const response = await driveFetch(`${DRIVE_API}?spaces=appDataFolder&q=${q}&fields=${fields}`, token);
  const data = await response.json();
  return data.files?.sort((a,b)=>String(b.modifiedTime).localeCompare(String(a.modifiedTime)))[0] || null;
}

async function upsertFile(token, name, body, contentType) {
  const existing = await findFile(token, name);
  if (existing) {
    await driveFetch(`${UPLOAD_API}/${existing.id}?uploadType=media`, token, {
      method: 'PATCH', headers: {'Content-Type':contentType}, body
    });
    return { id: existing.id, name, updated: true };
  }
  const boundary = `msty_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const metadata = JSON.stringify({name, parents:['appDataFolder']});
  const metaHeader = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`);
  const bodyBytes = body instanceof Blob ? new Uint8Array(await body.arrayBuffer()) : new TextEncoder().encode(String(body));
  const end = new TextEncoder().encode(`\r\n--${boundary}--`);
  const multipart = new Blob([metaHeader, bodyBytes, end]);
  const response = await driveFetch(`${UPLOAD_API}?uploadType=multipart`, token, {
    method:'POST', headers:{'Content-Type':`multipart/related; boundary=${boundary}`}, body:multipart
  });
  return response.json();
}

export async function saveDriveBackup(token, payload, portableZip) {
  const json=JSON.stringify(payload,null,2);
  const jsonResult=await upsertFile(token,DRIVE_JSON_NAME,json,'application/json;charset=utf-8');
  const zipResult=await upsertFile(token,DRIVE_ZIP_NAME,portableZip,'application/zip');
  return {json:jsonResult,zip:zipResult};
}

export async function loadDriveBackup(token) {
  const file = await findFile(token, DRIVE_JSON_NAME) || await findFile(token, LEGACY_JSON_NAME);
  if (!file) return null;
  const response = await driveFetch(`${DRIVE_API}/${file.id}?alt=media`, token);
  return { file, payload: await response.json() };
}
