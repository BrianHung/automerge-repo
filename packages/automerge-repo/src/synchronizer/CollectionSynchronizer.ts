import * as A from "@automerge/automerge"
import debug from "debug"
import { DocHandle } from "../DocHandle.js"
import { stringifyAutomergeUrl } from "../AutomergeUrl.js"
import { Repo } from "../Repo.js"
import { RepoMessage } from "../network/messages.js"
import { DocumentId, PeerId } from "../types.js"
import { DocSynchronizer } from "./DocSynchronizer.js"
import { Synchronizer } from "./Synchronizer.js"

const log = debug("automerge-repo:collectionsync")

/** A CollectionSynchronizer is responsible for synchronizing a DocCollection with peers. */
export class CollectionSynchronizer extends Synchronizer {
  /** The set of peers we are connected with */
  #peers: Set<PeerId> = new Set()

  /** A map of documentIds to their synchronizers */
  #docSynchronizers: Record<DocumentId, DocSynchronizer> = {}

  /** Used to determine if the document is know to the Collection and a synchronizer exists or is being set up */
  #docSetUp: Record<DocumentId, boolean> = {}

  constructor(private repo: Repo) {
    super()
  }

  /** Returns a synchronizer for the given document, creating one if it doesn't already exist.  */
  #fetchDocSynchronizer(documentId: DocumentId) {
    if (!this.#docSynchronizers[documentId]) {
      const handle = this.repo.find(stringifyAutomergeUrl({ documentId }))
      this.#docSynchronizers[documentId] = this.#initDocSynchronizer(handle)
    }
    return this.#docSynchronizers[documentId]
  }

  /** Creates a new docSynchronizer and sets it up to propagate messages */
  #initDocSynchronizer(handle: DocHandle<unknown>): DocSynchronizer {
    const docSynchronizer = new DocSynchronizer({
      handle,
      onLoadSyncState: peerId => {
        if (!this.repo.storageSubsystem) {
          return undefined
        }

        return this.repo.storageSubsystem.loadSyncState(
          handle.documentId,
          peerId
        )
      },
    })
    docSynchronizer.on("message", event => this.emit("message", event))
    docSynchronizer.on("sync-state", event => this.emit("sync-state", event))
    return docSynchronizer
  }

  /** returns an array of peerIds that we share this document generously with */
  async #documentGenerousPeers(documentId: DocumentId): Promise<PeerId[]> {
    const peers = Array.from(this.#peers)
    const generousPeers: PeerId[] = []
    for (const peerId of peers) {
      const okToShare = await this.repo.sharePolicy(peerId, documentId)
      if (okToShare) generousPeers.push(peerId)
    }
    return generousPeers
  }

  /** load stored sync state for generous peers and begin sync on doc synchronizer */
  async #beginSync(docSynchronizer: DocSynchronizer, peers: PeerId[]) {
    const documentId = docSynchronizer.documentId
    const storedSyncStates: Record<PeerId, A.SyncState> = {}
    const newPeers: PeerId[] = []

    for (const peerId of peers) {
      if (!docSynchronizer.hasPeer(peerId)) {
        const syncState = await this.repo.storageSubsystem?.loadSyncState(
          documentId,
          peerId
        )

        if (syncState) {
          storedSyncStates[peerId] = syncState
        }
        newPeers.push(peerId)
      }
    }
    docSynchronizer.beginSync(newPeers)
  }

  // PUBLIC

  /**
   * When we receive a sync message for a document we haven't got in memory, we
   * register it with the repo and start synchronizing
   */
  async receiveMessage(message: RepoMessage) {
    log(
      `onSyncMessage: ${message.senderId}, ${message.documentId}, ${
        "data" in message ? message.data.byteLength + "bytes" : ""
      }`
    )

    const documentId = message.documentId
    if (!documentId) {
      throw new Error("received a message with an invalid documentId")
    }

    this.#docSetUp[documentId] = true

    const docSynchronizer = this.#fetchDocSynchronizer(documentId)

    docSynchronizer.receiveMessage(message)

    // Initiate sync with any new peers
    const peers = await this.#documentGenerousPeers(documentId)

    // todo: call load sync state on doc synchronizer

    docSynchronizer.beginSync(
      peers.filter(peerId => !docSynchronizer.hasPeer(peerId))
    )
  }

  /**
   * Starts synchronizing the given document with all peers that we share it generously with.
   */
  addDocument(documentId: DocumentId) {
    // HACK: this is a hack to prevent us from adding the same document twice
    if (this.#docSetUp[documentId]) {
      return
    }
    const docSynchronizer = this.#fetchDocSynchronizer(documentId)
    void this.#documentGenerousPeers(documentId).then(peers => {
      docSynchronizer.beginSync(peers)
    })
  }

  // TODO: implement this
  removeDocument(documentId: DocumentId) {
    throw new Error("not implemented")
  }

  /** Adds a peer and maybe starts synchronizing with them */
  addPeer(peerId: PeerId) {
    log(`adding ${peerId} & synchronizing with them`)

    if (this.#peers.has(peerId)) {
      return
    }

    this.#peers.add(peerId)
    for (const docSynchronizer of Object.values(this.#docSynchronizers)) {
      const { documentId } = docSynchronizer
      void this.repo.sharePolicy(peerId, documentId).then(okToShare => {
        if (okToShare) docSynchronizer.beginSync([peerId])
      })
    }
  }

  /** Removes a peer and stops synchronizing with them */
  removePeer(peerId: PeerId) {
    log(`removing peer ${peerId}`)
    this.#peers.delete(peerId)

    for (const docSynchronizer of Object.values(this.#docSynchronizers)) {
      docSynchronizer.endSync(peerId)
    }
  }
}
