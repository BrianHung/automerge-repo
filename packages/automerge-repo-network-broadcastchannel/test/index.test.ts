import { BroadcastChannelNetworkAdapter } from "../src"
import { SetupFn, runAdapterTests } from "@automerge/automerge-repo"

describe("BroadcastChannel", () => {
  const setup: SetupFn = async () => {
    const a = new BroadcastChannelNetworkAdapter()
    const b = new BroadcastChannelNetworkAdapter()
    return { adapters: [a, b] }
  }

  runAdapterTests(setup)
})
