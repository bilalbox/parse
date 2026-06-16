import sharp from 'sharp';
import fs from 'fs';

if (!fs.existsSync('assets')) {
  fs.mkdirSync('assets');
}

async function generate() {
  await sharp('static/icon.svg')
    .resize(1024, 1024)
    .png()
    .toFile('assets/icon.png');
    
  // Generate a basic splash screen
  await sharp({
    create: {
      width: 2732,
      height: 2732,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    }
  })
    .composite([{ input: 'assets/icon.png' }])
    .png()
    .toFile('assets/splash.png');
}

generate().catch(console.error);
