import * as Automerge from "@automerge/automerge"
import { Repo } from "../src/Repo"
import { DocHandle, DocumentId } from "../src/DocHandle"
import { DummyNetworkAdapter } from "./helpers/DummyNetworkAdapter"
import { MemoryStorageAdapter } from "automerge-repo-storage-memory"
import { CollectionSynchronizer } from "../src/synchronizer/CollectionSynchronizer"

describe("CollectionSynchronizer", () => {
  it("TODO", async () => {
    const handle = new DocHandle("synced-doc" as DocumentId)
    const repo = new Repo({
      storage: new MemoryStorageAdapter(),
      network: [new DummyNetworkAdapter()],
    })
    const synchronizer = new CollectionSynchronizer(repo, false)
  })
})
