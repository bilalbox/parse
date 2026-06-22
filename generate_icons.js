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

  await sharp('static/icon.svg')
    .resize(1024, 1024)
    .png()
    .toFile('assets/icon-only.png');

  await sharp('static/icon.svg')
    .resize(1024, 1024)
    .png()
    .toFile('assets/icon-foreground.png');

  await sharp({
    create: {
      width: 1024,
      height: 1024,
      channels: 4,
      background: { r: 10, g: 10, b: 12, alpha: 1 }
    }
  })
    .png()
    .toFile('assets/icon-background.png');
    
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
