import { describe, expect, it } from "vitest"

import type { StorageAdapterInterface } from "../../storage/StorageAdapterInterface.js"

const PAYLOAD_A = new Uint8Array([
  56, 97, 51, 53, 99, 57, 98, 52, 45, 49, 48, 57, 101, 45, 52, 97, 55, 102, 45,
  97, 51, 53, 101, 45, 97, 53, 52, 54, 52, 49, 50, 49, 98, 54, 100, 100,
])
const PAYLOAD_B = new Uint8Array([0, 1, 127, 99, 154, 235])
const PAYLOAD_C = new Uint8Array([1, 76, 160, 53, 57, 10, 230])
const PAYLOAD_D = new Uint8Array([2, 111, 74, 131, 236, 96, 142, 193])

export function runStorageAdapterTests(_setup: SetupFn, title?: string): void {
  const setup = async () => {
    const { adapter, teardown = NO_OP } = await _setup()
    return { adapter, teardown }
  }

  describe(`Network adapter acceptance tests ${
    title ? `(${title})` : ""
  }`, () => {
    describe("load", () => {
      it("should return undefined if there is no data", async () => {
        const { adapter, teardown } = await setup()
        expect(
          await adapter.load(["3xuJ5", "sync-state", "d99d4"])
        ).toStrictEqual(undefined)
        teardown()
      })
    })

    describe("save and load", () => {
      it("should return data that was saved", async () => {
        const { adapter, teardown } = await setup()
        await adapter.save(["storage-adapter-id"], PAYLOAD_A)

        const actual = await adapter.load(["storage-adapter-id"])

        expect(actual).toStrictEqual(PAYLOAD_A)
        teardown()
      })

      it("should work with composite keys", async () => {
        const { adapter, teardown } = await setup()
        await adapter.save(["pSq9f", "sync-state", "3761c"], PAYLOAD_B)
        const actual = await adapter.load(["pSq9f", "sync-state", "3761c"])
        expect(actual).toStrictEqual(PAYLOAD_B)
        teardown()
      })
    })

    describe("loadRange", () => {
      it("should return an empty array if there is no data", async () => {
        const { adapter, teardown } = await setup()
        expect(await adapter.loadRange(["3xuJ5"])).toStrictEqual([])
        teardown()
      })
    })

    describe("save and loadRange", () => {
      it("should return all the data that is present", async () => {
        const { adapter, teardown } = await setup()
        await adapter.save(["3xuJ5", "sync-state", "d99d4"], PAYLOAD_B)
        await adapter.save(["3xuJ5", "snapshot", "7848c"], PAYLOAD_C)
        await adapter.save(["3xuJ5", "sync-state", "0e05e"], PAYLOAD_D)

        expect(await adapter.loadRange(["3xuJ5"])).toStrictEqual(
          expect.arrayContaining([
            { key: ["3xuJ5", "sync-state", "d99d4"], data: PAYLOAD_B },
            { key: ["3xuJ5", "snapshot", "7848c"], data: PAYLOAD_C },
            { key: ["3xuJ5", "sync-state", "0e05e"], data: PAYLOAD_D },
          ])
        )

        expect(await adapter.loadRange(["3xuJ5", "sync-state"])).toStrictEqual(
          expect.arrayContaining([
            { key: ["3xuJ5", "sync-state", "d99d4"], data: PAYLOAD_B },
            { key: ["3xuJ5", "sync-state", "0e05e"], data: PAYLOAD_D },
          ])
        )
      })

      it("does not includes values which shouldn't be there", async () => {
        const { adapter, teardown } = await setup()
        await adapter.save(["3xuJ5", "sync-state", "d99d4"], PAYLOAD_B)
        await adapter.save(["3xuJ6", "sync-state", "0e05e"], PAYLOAD_D)

        const actual = await adapter.loadRange(["3xuJ5"])
        expect(actual).toStrictEqual(
          expect.arrayContaining([
            { key: ["3xuJ5", "sync-state", "d99d4"], data: PAYLOAD_B },
          ])
        )
        expect(actual).toStrictEqual(
          expect.not.arrayContaining([
            { key: ["3xuJ6", "sync-state", "0e05e"], data: PAYLOAD_D },
          ])
        )
        teardown()
      })
    })

    describe("save and remove", () => {
      it("should be no data", async () => {
        const { adapter, teardown } = await setup()
        await adapter.save(["3xuJ5", "snapshot", "09014"], PAYLOAD_B)
        await adapter.remove(["3xuJ5", "snapshot", "09014"])

        expect(await adapter.loadRange(["3xuJ5"])).toStrictEqual([])
        expect(
          await adapter.load(["3xuJ5", "snapshot", "09014"])
        ).toStrictEqual(undefined)
        teardown()
      })
    })

    describe("save and save", () => {
      it("should overwrite data saved with the same key", async () => {
        const { adapter, teardown } = await setup()
        await adapter.save(["3xuJ5", "sync-state", "d99d4"], PAYLOAD_B)
        await adapter.save(["3xuJ5", "sync-state", "d99d4"], PAYLOAD_C)

        expect(await adapter.loadRange(["3xuJ5", "sync-state"])).toStrictEqual([
          { key: ["3xuJ5", "sync-state", "d99d4"], data: PAYLOAD_C },
        ])
        teardown()
      })
    })

    describe("removeRange", () => {
      it("should remove set of records", async () => {
        const { adapter, teardown } = await setup()
        await adapter.save(["3xuJ5", "sync-state", "d99d4"], PAYLOAD_B)
        await adapter.save(["3xuJ5", "snapshot", "7848c"], PAYLOAD_C)
        await adapter.save(["3xuJ5", "sync-state", "0e05e"], PAYLOAD_D)

        await adapter.removeRange(["3xuJ5", "sync-state"])

        expect(await adapter.loadRange(["3xuJ5"])).toStrictEqual([
          { key: ["3xuJ5", "snapshot", "7848c"], data: PAYLOAD_C },
        ])
        teardown()
      })

      it("should not remove set of records that doesn't match", async () => {
        const { adapter, teardown } = await setup()
        await adapter.save(["3xuJ5", "sync-state", "d99d4"], PAYLOAD_B)
        await adapter.save(["3xuJ6", "sync-state", "0e05e"], PAYLOAD_C)

        await adapter.removeRange(["3xuJ5"])

        const actual = await adapter.loadRange(["3xuJ6"])
        expect(actual).toStrictEqual([
          { key: ["3xuJ6", "sync-state", "0e05e"], data: PAYLOAD_C },
        ])
        teardown()
      })
    })
  })
}

const NO_OP = () => {}

export type SetupFn = () => Promise<{
  adapter: StorageAdapterInterface
  teardown?: () => void
}>
