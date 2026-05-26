require('dotenv').config();
const twilio = require('twilio');
const fs = require('fs');
const https = require('https');

const SID = process.env.TWILIO_ACCOUNT_SID;
const TOKEN = process.env.TWILIO_AUTH_TOKEN;

// Upload file during document creation using multipart form
async function run() {
  const filePath = 'C:/Users/unais/.gemini/antigravity/brain/56d7102b-19c8-4097-b488-ebf0c7a77e93/dni_combined.png';
  const boundary = '----FormBoundary' + Date.now();
  const fileData = fs.readFileSync(filePath);
  
  const attrs = JSON.stringify({
    first_name: 'Unai',
    last_name: 'Sanchez Pereyra',
    document_number: '49575893Z',
    issuing_country: 'ES',
    nationality: 'ES',
    birth_date: '2005-05-13',
    birth_place: 'Andoain',
    expiry_date: '2028-01-31',
    identification_document_number: 'CEK132059'
  });

  function addField(name, value) {
    return `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  }

  const parts = [
    Buffer.from(addField('FriendlyName', 'DNI Unai SP Both Sides v2')),
    Buffer.from(addField('Type', 'national_id_card')),
    Buffer.from(addField('Attributes', attrs)),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="File"; filename="dni_combined.png"\r\nContent-Type: image/png\r\n\r\n`),
    fileData,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ];
  
  const bodyBuffer = Buffer.concat(parts);

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'numbers.twilio.com',
      path: '/v2/RegulatoryCompliance/SupportingDocuments',
      method: 'POST',
      auth: SID + ':' + TOKEN,
      headers: {
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': bodyBuffer.length
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', async () => {
        console.log('Create+Upload status:', res.statusCode);
        const parsed = JSON.parse(data);
        console.log('Doc SID:', parsed.sid);
        console.log('Doc Status:', parsed.status);
        
        if (parsed.sid) {
          await updateBundle(parsed.sid);
        }
        resolve();
      });
    });
    req.write(bodyBuffer);
    req.end();
  });
}

async function updateBundle(newDocSid) {
  const client = twilio(SID, TOKEN);
  const bundleSid = 'BU41375a0ddc8436be73ae5331e05c49a8';
  const oldDocSid = 'RD6cd32f7f9f1362658f0c2ffadbe471a3';
  
  // Remove old rejected doc
  try {
    const items = await client.numbers.v2.regulatoryCompliance.bundles(bundleSid).itemAssignments.list();
    console.log('Bundle items:', items.length);
    for (const item of items) {
      if (item.objectSid === oldDocSid) {
        await client.numbers.v2.regulatoryCompliance.bundles(bundleSid).itemAssignments(item.sid).remove();
        console.log('Removed old rejected doc');
      }
    }
  } catch(e) {
    console.log('Remove note:', e.message);
  }
  
  // Add new doc
  try {
    const newItem = await client.numbers.v2.regulatoryCompliance.bundles(bundleSid).itemAssignments.create({ objectSid: newDocSid });
    console.log('Added new doc:', newItem.sid);
  } catch(e) {
    console.log('Add note:', e.message);
  }
  
  // Submit for review
  try {
    const updated = await client.numbers.v2.regulatoryCompliance.bundles(bundleSid).update({ status: 'pending-review' });
    console.log('Bundle resubmitted! Status:', updated.status);
  } catch(e) {
    console.log('Submit note:', e.message);
  }
  
  console.log('DONE!');
}

run().catch(e => console.error('Error:', e.message));
