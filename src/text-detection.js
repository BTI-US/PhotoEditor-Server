const vision = require('@google-cloud/vision');
const fs = require('fs');
const Engine = require('json-rules-engine').Engine;

// Load the JSON key into memory
const key = JSON.parse(fs.readFileSync('../google-application-credentials.json'));

if (!key) {
  console.error('Unable to load Google Cloud credentials from google-application-credentials.json');
  process.exit(1);
}

// Create a client
const client = new vision.ImageAnnotatorClient({
  credentials: {
    client_email: key.client_email,
    private_key: key.private_key
  }
});

// Create a new rules engine
const engine = new Engine();

// TODO: Add a rule for classification
// Note: We need to modify this rule according to the actual requirements
engine.addRule({
  conditions: {
    any: [{
      fact: 'text',
      operator: 'contains',
      value: 'some keyword'
    }]
  },
  event: {
    type: 'classification',
    params: {
      message: 'Text contains the keyword'
    }
  }
});

async function detectMnemonicPhrase (fileName) {
  // Read the image file
  const [result] = await client.textDetection(fileName);
  const detections = result.textAnnotations;
  console.log('Text:');
  detections.forEach(text => console.log(text));

  // Classify the text
  const facts = { text: detections.map(detection => detection.description).join(' ') };
  const { events } = await engine.run(facts);
  events.forEach(event => console.log(event.params.message));
}

module.exports = {
  detectMnemonicPhrase
};
