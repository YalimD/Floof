// Sprite packs: a folder with sprite.json + a PNG sheet.
// Built-in packs live in the app's sprites/ folder; your own go in %APPDATA%\floof\sprites.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { nativeImage } = require('electron');

class SpritePacks {
  constructor({ builtinDir, userDir, log }) {
    this.builtinDir = builtinDir;
    this.userDir = userDir;
    this.log = log;
  }

  list() {
    const packs = [];
    for (const [dir, own] of [[this.builtinDir, false], [this.userDir, true]]) {
      if (!fs.existsSync(dir)) continue;
      for (const folder of fs.readdirSync(dir)) {
        const manifestPath = path.join(dir, folder, 'sprite.json');
        if (!fs.existsSync(manifestPath)) continue;
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
          validate(manifest);
          const sheet = path.join(dir, folder, manifest.sheet || 'sheet.png');
          if (!fs.existsSync(sheet)) throw new Error(`missing ${manifest.sheet || 'sheet.png'}`);
          packs.push({ name: manifest.name || folder, folder, own, sheetUrl: pathToFileURL(sheet).href, manifest });
        } catch (err) {
          this.log(`skipping sprite pack ${folder}: ${err.message}`);
        }
      }
    }
    return packs;
  }

  // Copy a folder that already has sprite.json + sheet into the user's sprites folder.
  importFolder(src) {
    const manifest = JSON.parse(fs.readFileSync(path.join(src, 'sprite.json'), 'utf8'));
    validate(manifest);
    if (!fs.existsSync(path.join(src, manifest.sheet || 'sheet.png'))) throw new Error(`the folder has no ${manifest.sheet || 'sheet.png'}`);
    const dest = this.freeFolder(manifest.name || path.basename(src));
    fs.cpSync(src, dest, { recursive: true });
    return path.basename(dest);
  }

  // Make a pack from a single PNG strip: frames side by side, used as the walk animation.
  importStrip(file, frames, name) {
    const img = nativeImage.createFromPath(file);
    if (img.isEmpty()) throw new Error('that file is not a readable PNG');
    const { width, height } = img.getSize();
    frames = Math.max(1, Math.floor(Number(frames) || 1));
    const frameWidth = Math.floor(width / frames);
    if (frameWidth < 4) throw new Error('too many frames for this image width');
    name = (name || path.basename(file, path.extname(file))).trim() || 'my-critter';
    const dest = this.freeFolder(name);
    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(file, path.join(dest, 'sheet.png'));
    const scale = Math.max(1, Math.round(96 / Math.max(frameWidth, height)));
    const manifest = {
      name,
      sheet: 'sheet.png',
      frameWidth,
      frameHeight: height,
      scale,
      facing: 'right',
      animations: {
        walk: { row: 0, frames, fps: 6 },
        idle: { row: 0, frames: 1, fps: 1 },
      },
    };
    fs.writeFileSync(path.join(dest, 'sprite.json'), JSON.stringify(manifest, null, 2));
    return path.basename(dest);
  }

  remove(folder) {
    const dir = path.join(this.userDir, path.basename(folder));
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }

  freeFolder(name) {
    fs.mkdirSync(this.userDir, { recursive: true });
    const safe = name.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'pack';
    let dest = path.join(this.userDir, safe);
    for (let i = 2; fs.existsSync(dest); i++) dest = path.join(this.userDir, `${safe}-${i}`);
    return dest;
  }
}

function validate(m) {
  if (!m || typeof m !== 'object') throw new Error('sprite.json is not an object');
  if (!(m.frameWidth > 0 && m.frameHeight > 0)) throw new Error('frameWidth and frameHeight are required');
}

module.exports = { SpritePacks };
