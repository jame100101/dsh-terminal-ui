/** Read fixture heap snapshots without printing session text or credential values. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
function summarize(path) {
  const { snapshot, nodes, strings } = JSON.parse(readFileSync(path, 'utf8'))
  const fields = snapshot.meta.node_fields, width = fields.length
  const type = fields.indexOf('type'), name = fields.indexOf('name'), size = fields.indexOf('self_size')
  assert(type >= 0 && name >= 0 && size >= 0, 'Unsupported heap format')
  const types = snapshot.meta.node_types[type]
  let sourceDocuments=0, sourceBytes=0, lineClosures=0, totalBytes=0
  for(let i=0;i<nodes.length;i+=width) {
    totalBytes+=nodes[i+size]
    const label=strings[nodes[i+name]], kind=types[nodes[i+type]]
    if(kind==='string' && label.startsWith('DSH-TUI masked session source\n') && nodes[i+size]>10000) {sourceDocuments++;sourceBytes+=nodes[i+size]}
    if(kind==='closure' && label==='lines') lineClosures++
  }
  return {sourceDocuments,sourceBytes,lineClosures,totalBytes}
}
assert(process.argv[2] && process.argv[3], 'Provide early and late synthetic-host heap snapshots')
const before=summarize(process.argv[2]), after=summarize(process.argv[3])
console.log(JSON.stringify({before,after,sourceGrowth:after.sourceDocuments-before.sourceDocuments}))
// This contract belongs to host-soak: closed inspectors from past sessions must
// not accumulate. Two live React trees and the one-entry source cache may survive.
assert(after.sourceDocuments<=4 && after.sourceDocuments-before.sourceDocuments<=2,'Closed source inspection documents are retained')
