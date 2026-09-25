import fs from 'fs'
import path from 'path'

const SOURCE_ROOTS = ['components', 'pages']

function getJavaScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return getJavaScriptFiles(entryPath)
    return /\.(js|jsx)$/.test(entry.name) ? [entryPath] : []
  })
}

describe('backend URL configuration', () => {
  test('frontend API consumers use the configured backend_url property', () => {
    const invalidConsumers = SOURCE_ROOTS
      .flatMap(root => getJavaScriptFiles(path.join(__dirname, '..', root)))
      .filter(file => fs.readFileSync(file, 'utf8').includes('config.apiUrl'))
      .map(file => path.relative(path.join(__dirname, '..'), file))

    expect(invalidConsumers).toEqual([])
  })
})
