import { Message, NetworkAdapter, PeerId } from "@automerge/automerge-repo"

export class BroadcastChannelNetworkAdapter extends NetworkAdapter {
  #broadcastChannel: BroadcastChannel

  connect(peerId: PeerId) {
    this.peerId = peerId
    this.#broadcastChannel = new BroadcastChannel(`broadcast`)

    this.#broadcastChannel.addEventListener(
      "message",
      (e: { data: AdapterMessage }) => {
        const message = e.data
        if ("targetId" in message && message.targetId !== this.peerId) {
          return
        }

        const { senderId, type } = message

        switch (type) {
          case "arrive":
            this.#broadcastChannel.postMessage({
              senderId: this.peerId,
              targetId: senderId,
              type: "welcome",
            })
            this.#announceConnection(senderId)
            break
          case "welcome":
            this.#announceConnection(senderId)
            break
          default:
            if (!("data" in message)) {
              this.emit("message", message)
            } else {
              this.emit("message", {
                ...message,
                data: new Uint8Array(message.data),
              })
            }
            break
        }
      }
    )
  }

  #announceConnection(peerId: PeerId) {
    this.emit("peer-candidate", { peerId })
  }

  send(message: Message) {
    if ("data" in message) {
      this.#broadcastChannel.postMessage({
        ...message,
        data: message.data.buffer.slice(
          message.data.byteOffset,
          message.data.byteOffset + message.data.byteLength
        ),
      })
    } else {
      this.#broadcastChannel.postMessage(message)
    }
  }

  join() {
    this.#broadcastChannel.postMessage({
      senderId: this.peerId,
      type: "arrive",
    })
  }

  leave() {
    // TODO
    throw new Error("Unimplemented: leave on BroadcastChannelNetworkAdapter")
  }
}

//types

type ArriveMessage = {
  senderId: PeerId
  type: "arrive"
}

type WelcomeMessage = {
  senderId: PeerId
  targetId: PeerId
  type: "welcome"
}

type AdapterMessage = ArriveMessage | WelcomeMessage | Message
