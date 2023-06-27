import { runAdapterTests } from "@automerge/automerge-repo"
import { MessageChannelNetworkAdapter as Adapter } from "../src"

// bob is the hub, alice and charlie are spokes
describe("MessageChannelNetworkAdapter", () => {
  runAdapterTests(async () => {
    const aliceBobChannel = new MessageChannel()
    const bobCharlieChannel = new MessageChannel()

    const { port1: aliceToBob, port2: bobToAlice } = aliceBobChannel
    const { port1: bobToCharlie, port2: charlieToBob } = bobCharlieChannel

    const a = new Adapter(aliceToBob)
    const b = [new Adapter(bobToAlice), new Adapter(bobToCharlie)]
    const c = new Adapter(charlieToBob)

    return { adapters: [a, b, c] }
  }, "hub and spoke")

  // all 3 peers connected directly to each other
  runAdapterTests(async () => {
    const aliceBobChannel = new MessageChannel()
    const bobCharlieChannel = new MessageChannel()
    const aliceCharlieChannel = new MessageChannel()

    const { port1: aliceToBob, port2: bobToAlice } = aliceBobChannel
    const { port1: bobToCharlie, port2: charlieToBob } = bobCharlieChannel
    const { port1: aliceToCharlie, port2: charlieToAlice } = aliceCharlieChannel

    const a = [new Adapter(aliceToBob), new Adapter(aliceToCharlie)]
    const b = [new Adapter(bobToAlice), new Adapter(bobToCharlie)]
    const c = [new Adapter(charlieToBob), new Adapter(charlieToAlice)]

    const teardown = () => {
      aliceBobChannel.port1.close()
      aliceBobChannel.port2.close()
      bobCharlieChannel.port1.close()
      bobCharlieChannel.port2.close()
      aliceCharlieChannel.port1.close()
      aliceCharlieChannel.port2.close()
    }

    return { adapters: [a, b, c], teardown }
  }, "all-to-all")
})
