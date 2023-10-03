import debug from "debug"
import { NetworkAdapter } from "./network/NetworkAdapter.js"
import { NetworkSubsystem } from "./network/NetworkSubsystem.js"
import { StorageAdapter } from "./storage/StorageAdapter.js"
import { StorageSubsystem } from "./storage/StorageSubsystem.js"
import { CollectionSynchronizer } from "./synchronizer/CollectionSynchronizer.js"
import { type AutomergeUrl, DocumentId, PeerId } from "./types.js"
import { v4 as uuid } from "uuid"
import {
  parseAutomergeUrl,
  generateAutomergeUrl,
  isValidAutomergeUrl,
  parseLegacyUUID,
} from "./DocUrl.js"

import { DocHandle } from "./DocHandle.js"
import { EventEmitter } from "eventemitter3"
import { next as Automerge } from "@automerge/automerge"

/** A Repo is a collection of documents with networking, syncing, and storage capabilities. */
/** The `Repo` is the main entry point of this library
 *
 * @remarks
 * To construct a `Repo` you will need an {@link StorageAdapter} and one or
 * more {@link NetworkAdapter}s. Once you have a `Repo` you can use it to
 * obtain {@link DocHandle}s.
 */
export class Repo extends EventEmitter<RepoEvents> {
  #log: debug.Debugger

  /** @hidden */
  networkSubsystem: NetworkSubsystem
  /** @hidden */
  storageSubsystem?: StorageSubsystem
  #handleCache: Record<DocumentId, DocHandle<any>> = {}

  /** By default, we share generously with all peers. */
  /** @hidden */
  sharePolicy: SharePolicy = async () => true

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
        this.networkSubsystem
          .whenReady()
          .then(() => {
            handle.networkReady()
          })
          .catch(err => {
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

  /** Returns an existing handle if we have it; creates one otherwise. */
  #getHandle<T>(
    /** The documentId of the handle to look up or create */
    documentId: DocumentId,

    /** If we know we're creating a new document, specify this so we can have access to it immediately */
    isNew: boolean
  ) {
    // If we have the handle cached, return it
    if (this.#handleCache[documentId]) return this.#handleCache[documentId]

    // If not, create a new handle, cache it, and return it
    if (!documentId) throw new Error(`Invalid documentId ${documentId}`)
    const handle = new DocHandle<T>(documentId, { isNew })
    this.#handleCache[documentId] = handle
    return handle
  }

  /** Returns all the handles we have cached. */
  get handles() {
    return this.#handleCache
  }

  /**
   * Creates a new document and returns a handle to it. The initial value of the document is
   * an empty object `{}`. Its documentId is generated by the system. we emit a `document` event
   * to advertise interest in the document.
   */
  create<T>(): DocHandle<T> {
    // TODO:
    // either
    // - pass an initial value and do something like this to ensure that you get a valid initial value

    // const myInitialValue = {
    //   tasks: [],
    //   filter: "all",
    //
    // const guaranteeInitialValue = (doc: any) => {
    // if (!doc.tasks) doc.tasks = []
    // if (!doc.filter) doc.filter = "all"

    //   return { ...myInitialValue, ...doc }
    // }

    // or
    // - pass a "reify" function that takes a `<any>` and returns `<T>`

    // Generate a new UUID and store it in the buffer
    const { documentId } = parseAutomergeUrl(generateAutomergeUrl())
    const handle = this.#getHandle<T>(documentId, true) as DocHandle<T>
    this.emit("document", { handle, isNew: true })
    return handle
  }

  clone<T>(clonedHandle: DocHandle<T>) {
    if (!clonedHandle.isReady()) {
      throw new Error(
        `Cloned handle is not yet in ready state.
        (Try await handle.waitForReady() first.)`
      )
    }

    const sourceDoc = clonedHandle.docSync()
    if (!sourceDoc) {
      throw new Error("Cloned handle doesn't have a document.")
    }

    const handle = this.create<T>()

    handle.update((doc: Automerge.Doc<T>) => {
      // we replace the document with the new cloned one
      return Automerge.clone(sourceDoc)
    })

    return handle
  }

  /**
   * Retrieves a document by id. It gets data from the local system, but also emits a `document`
   * event to advertise interest in the document.
   */
  find<T>(
    /** The documentId of the handle to retrieve */
    automergeUrl: AutomergeUrl
  ): DocHandle<T> {
    if (!isValidAutomergeUrl(automergeUrl)) {
      let maybeAutomergeUrl = parseLegacyUUID(automergeUrl)
      if (maybeAutomergeUrl) {
        console.warn(
          "Legacy UUID document ID detected, converting to AutomergeUrl. This will be removed in a future version."
        )
        automergeUrl = maybeAutomergeUrl
      } else {
        throw new Error(`Invalid AutomergeUrl: '${automergeUrl}'`)
      }
    }

    const { documentId } = parseAutomergeUrl(automergeUrl)
    // If we have the handle cached, return it
    if (this.#handleCache[documentId]) {
      if (this.#handleCache[documentId].isUnavailable()) {
        // this ensures that the event fires after the handle has been returned
        setTimeout(() => {
          this.#handleCache[documentId].emit("unavailable", {
            handle: this.#handleCache[documentId],
          })
        })
      }
      return this.#handleCache[documentId]
    }

    const handle = this.#getHandle<T>(documentId, false) as DocHandle<T>
    this.emit("document", { handle, isNew: false })
    return handle
  }

  delete(
    /** The documentId of the handle to delete */
    id: DocumentId | AutomergeUrl
  ) {
    if (isValidAutomergeUrl(id)) {
      ;({ documentId: id } = parseAutomergeUrl(id))
    }

    const handle = this.#getHandle(id, false)
    handle.delete()

    delete this.#handleCache[id]
    this.emit("delete-document", {
      documentId: id,
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

/** A function that determines whether we should share a document with a peer
 *
 * @remarks
 * This function is called by the {@link Repo} every time a new document is created
 * or discovered (such as when another peer starts syncing with us). If this
 * function returns `true` then the {@link Repo} will begin sharing the new
 * document with the peer given by `peerId`.
 * */
export type SharePolicy = (
  peerId: PeerId,
  documentId?: DocumentId
) => Promise<boolean>

// events & payloads
export interface RepoEvents {
  /** A new document was created or discovered */
  document: (arg: DocumentPayload) => void
  /** A document was deleted */
  "delete-document": (arg: DeleteDocumentPayload) => void
  /** A document was marked as unavailable (we don't have it and none of our peers have it) */
  "unavailable-document": (arg: DeleteDocumentPayload) => void
}

export interface DocumentPayload {
  handle: DocHandle<any>
  isNew: boolean
}

export interface DeleteDocumentPayload {
  documentId: DocumentId
}
