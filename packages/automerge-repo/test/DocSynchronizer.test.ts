import assert from "assert"
import { DocumentId, PeerId } from "../src/types.js"
import { DocHandle } from "../src/DocHandle.js"
import { DocSynchronizer } from "../src/synchronizer/DocSynchronizer.js"
import { eventPromise } from "../src/helpers/eventPromise.js"
import { TestDoc } from "./types.js"

const alice = "alice" as PeerId
const bob = "bob" as PeerId

describe("DocSynchronizer", () => {
  let handle: DocHandle<TestDoc>
  let docSynchronizer: DocSynchronizer

  const setup = () => {
    const docId = "synced-doc" as DocumentId
    handle = new DocHandle<TestDoc>(docId, { isNew: true })
    docSynchronizer = new DocSynchronizer(handle)
    return { handle, docSynchronizer }
  }

  it("takes the handle passed into it", () => {
    const { handle, docSynchronizer } = setup()
    assert(docSynchronizer.documentId === handle.documentId)
  })

  it("emits a syncMessage when beginSync is called", async () => {
    const { docSynchronizer } = setup()
    docSynchronizer.beginSync(alice)
    const { recipientId } = await eventPromise(docSynchronizer, "message")
    assert.equal(recipientId, "alice")
  })

  it("emits a syncMessage to peers when the handle is updated", async () => {
    const { handle, docSynchronizer } = setup()
    docSynchronizer.beginSync(alice)
    handle.change(doc => {
      doc.foo = "bar"
    })
    const { recipientId } = await eventPromise(docSynchronizer, "message")
    assert.equal(recipientId, "alice")
  })

  it("still syncs with a peer after it disconnects and reconnects", async () => {
    const { handle, docSynchronizer } = setup()

    // first connection
    {
      docSynchronizer.beginSync(bob)
      handle.change(doc => {
        doc.foo = "a change"
      })
      const { recipientId } = await eventPromise(docSynchronizer, "message")
      assert.equal(recipientId, "bob")
      docSynchronizer.endSync(bob)
    }

    // second connection
    {
      docSynchronizer.beginSync(bob)
      handle.change(doc => {
        doc.foo = "another change"
      })
      const { recipientId } = await eventPromise(docSynchronizer, "message")
      assert.equal(recipientId, "bob")
    }
  })
})
