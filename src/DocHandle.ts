/* So this class is kind of terrible because we have to be careful to preserve a 1:1
 * relationship between handles and documentIds or else we have split-brain on listeners.
 * It would be easier just to have one repo object to pass around but that means giving
 * total repo access to everything which seems gratuitous to me.
 */
import EventEmitter from 'eventemitter3'
import * as Automerge from 'automerge-js'

interface DocHandleEventArg { 
  handle: DocHandle, 
  documentId: string, 
  doc: Automerge.Doc, 
  changes: Uint8Array[]
}
export interface DocHandleEvents {
  'change': (event: DocHandleEventArg) => void
}

export default class DocHandle extends EventEmitter<DocHandleEvents> implements EventEmitter<DocHandleEvents> {
  doc: Automerge.AutomergeDoc

  documentId

  constructor(documentId: string) {
    super()
    if (!documentId) { throw new Error('Need a document ID for this RepoDoc.') }
    this.documentId = documentId
  }

  // should i move this?
  change(callback: (doc: Automerge.Doc) => void) {
    const doc = Automerge.change(this.doc, callback)
    this.replace(doc)
  }

  replace(doc: Automerge.Doc) {
    const oldDoc = this.doc
    this.doc = doc
    const { documentId } = this
    this.emit('change', {
      handle: this,
      documentId,
      doc,
      changes: Automerge.getChanges(oldDoc || Automerge.init(), doc),
    })
  }


  /* hmmmmmmmmmmm */
  async value() {
    if (!this.doc) {
      /* this bit of jank blocks anyone else getting the value
         before the first time data gets set into here */
      await new Promise((resolve) => {
        this.once('change', resolve)
      })
    }
    return this.doc
  }

  /* these would ideally be exposed on the text/list proxy objs; doing them here
   * for experimental purposes only. */
  dangerousLowLevel() {
    return Automerge.getBackend(this.doc)
  }

  getObjId(objId: string, attr: string) {
    const data = this.dangerousLowLevel().getAll(objId, attr)
    if (data && data.length === 1) { return data[0][1] }
  }

  getMarks(objId: string) {
    return this.dangerousLowLevel().raw_spans(objId)
  }

  mark(objId: string, range: string, name: string, value: string) {
    this.dangerousLowLevel().mark(objId, range, name, value)
  }

  insertAt(objId: string, position: number, value: unknown) {
    const ins = this.dangerousLowLevel().splice(objId, position, 0, value)
    this.replace(this.doc)
    return ins
  }

  deleteAt(objId: string, position: number, count = 1) {
    return this.dangerousLowLevel().splice(objId, position, count, '')
  }

  insertBlock(objId: string, position: number, type: string, attributes: { [attr: string]: unknown } = {}) {
    const block = { type } as { [k: string]: unknown }
    Object.keys(attributes).forEach((key) => {
      block[`attribute-${key}`] = attributes[key]
    })
    return this.dangerousLowLevel().insertObject(objId, position, block)
  }

  getBlock(objId: string, position: string) {
    throw new Error("getBlock unimplemented" + objId + position)
  }
}
