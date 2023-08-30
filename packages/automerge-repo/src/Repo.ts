import debug from "debug"
import { DocCollection } from "./DocCollection.js"
import { NetworkAdapter } from "./network/NetworkAdapter.js"
import { NetworkSubsystem } from "./network/NetworkSubsystem.js"
import { StorageAdapter } from "./storage/StorageAdapter.js"
import { StorageSubsystem } from "./storage/StorageSubsystem.js"
import { CollectionSynchronizer } from "./synchronizer/CollectionSynchronizer.js"
import { DocumentId, PeerId } from "./types.js"

/** A Repo is a DocCollection with networking, syncing, and storage capabilities. */
export class Repo extends DocCollection {
  #log: debug.Debugger

  networkSubsystem: NetworkSubsystem
  storageSubsystem?: StorageSubsystem

  constructor({ storage, network, peerId, sharePolicy }: RepoConfig) {
    super()
    this.#log = debug(`automerge-repo:repo`)
    this.sharePolicy = sharePolicy ?? this.sharePolicy

    // DOC COLLECTION

    // The `document` event is fired by the DocCollection any time we create a new document or look
    // up a document by ID. We listen for it in order to wire up storage and network synchronization.
    this.on("document", async ({ handle, isNew }) => {
      if (storageSubsystem) {
        // Save when the document changes
        handle.on("heads-changed", async ({ handle, doc }) => {
          await storageSubsystem.saveDoc(handle.documentId, doc)
        })

        if (isNew) {
          // this is a new document, immediately save it
          await storageSubsystem.saveDoc(handle.documentId, handle.docSync()!)
        } else {
          // Try to load from disk
          const loadedDoc = await storageSubsystem.loadDoc(handle.documentId)
          if (loadedDoc) {
            handle.update(() => loadedDoc)
          }
        }
      }

      handle.on("unavailable", () => {
        this.#log("document unavailable", { documentId: handle.documentId })
        this.emit("unavailable-document", {
          documentId: handle.documentId,
        })
      })

      if (this.networkSubsystem.isReady()) {
        handle.request()
      } else {
        handle.awaitNetwork()
        this.networkSubsystem.whenReady().then(() => {
          handle.networkReady()
        }).catch(err => {
          this.#log("error waiting for network", { err })
        })
      }

      // Register the document with the synchronizer. This advertises our interest in the document.
      synchronizer.addDocument(handle.documentId)
    })

    this.on("delete-document", ({ documentId }) => {
      // TODO Pass the delete on to the network
      // synchronizer.removeDocument(documentId)

      if (storageSubsystem) {
        storageSubsystem.remove(documentId).catch(err => {
          this.#log("error deleting document", { documentId, err })
        })
      }
    })

    // SYNCHRONIZER
    // The synchronizer uses the network subsystem to keep documents in sync with peers.
    const synchronizer = new CollectionSynchronizer(this)

    // When the synchronizer emits sync messages, send them to peers
    synchronizer.on("message", message => {
      this.#log(`sending sync message to ${message.targetId}`)
      networkSubsystem.send(message)
    })

    // STORAGE
    // The storage subsystem has access to some form of persistence, and deals with save and loading documents.
    const storageSubsystem = storage ? new StorageSubsystem(storage) : undefined
    this.storageSubsystem = storageSubsystem

    // NETWORK
    // The network subsystem deals with sending and receiving messages to and from peers.
    const networkSubsystem = new NetworkSubsystem(network, peerId)
    this.networkSubsystem = networkSubsystem

    // When we get a new peer, register it with the synchronizer
    networkSubsystem.on("peer", async ({ peerId }) => {
      this.#log("peer connected", { peerId })
      synchronizer.addPeer(peerId)
    })

    // When a peer disconnects, remove it from the synchronizer
    networkSubsystem.on("peer-disconnected", ({ peerId }) => {
      synchronizer.removePeer(peerId)
    })

    // Handle incoming messages
    networkSubsystem.on("message", async msg => {
      await synchronizer.receiveMessage(msg)
    })
  }
}

export interface RepoConfig {
  /** Our unique identifier */
  peerId?: PeerId

  /** A storage adapter can be provided, or not */
  storage?: StorageAdapter

  /** One or more network adapters must be provided */
  network: NetworkAdapter[]

  /**
   * Normal peers typically share generously with everyone (meaning we sync all our documents with
   * all peers). A server only syncs documents that a peer explicitly requests by ID.
   */
  sharePolicy?: SharePolicy
}

export type SharePolicy = (
  peerId: PeerId,
  documentId?: DocumentId
) => Promise<boolean>
