const fs = require('node:fs');
const path = require('node:path');

function readReleaseNotes(root, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Versão inválida para publicação estável.');
  const notesFile = path.join(root, 'release-notes', `v${version}.md`);
  if (!fs.existsSync(notesFile)) {
    throw new Error(`Falta release-notes/v${version}.md. Escreva o resumo das novidades para os jogadores antes de publicar.`);
  }
  const body = fs.readFileSync(notesFile, 'utf8').replace(/^\uFEFF/, '').trim();
  if (!/^[-*] \S.+/m.test(body) || /\b(TODO|TBD|PREENCHER)\b/.test(body)) {
    throw new Error('O resumo precisa conter novidades revisadas em uma lista, sem marcadores pendentes.');
  }
  if (body.length > 3500) throw new Error('Resuma as novidades em até 3.500 caracteres para o Discord.');
  return { notesFile, body };
}

if (require.main === module) {
  try {
    const root = path.resolve(__dirname, '../..');
    const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const { notesFile } = readReleaseNotes(root, version);
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `notes_file=${notesFile}\n`);
    console.log(`Resumo da versão ${version} validado.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { readReleaseNotes };
