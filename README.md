# pouchdb-cabal

[![Stability](https://img.shields.io/badge/stability-experimental-orange.svg?style=flat-square)](https://nodejs.org/api/documentation.html#documentation_stability_index)
[![NPM Version](https://img.shields.io/npm/v/@garbados/pouchdb-cabal.svg?style=flat-square)](https://www.npmjs.com/package/@garbados/pouchdb-cabal)
[![JS Standard Style](https://img.shields.io/badge/code%20style-standard-brightgreen.svg?style=flat-square)](https://github.com/feross/standard)

Interact with [Cabal](https://cabal.chat/) using [PouchDB](https://pouchdb.com/). Comparable to [cabal-core](https://github.com/cabal-club/cabal-core/).

## Why?

Cabal is a P2P chat application that uses [kappa-db](https://github.com/kappa-db/) to store and index information. This project demonstrates a minimum viable alternate client, where a distinct database is used for storage and indexing. It's deadly to lock yourself into a single database, and this project shows that in the Cabal ecosystem, you don't have to.

Plus I like using PouchDB.

As PouchDB supports plugins, you can easily extend pouchdb-cabal to include methods pertaining to more types. For example:

```js
PouchDB.plugin(require('@garbados/pouchdb-cabal'))
PouchDB.plugin({
  publishChannelJoin: async function (channel) {
    return this.publish({
      type: 'channel/join',
      content: { channel }
    })
  },
  publishChannelLeave: async function (channel) {
    return this.publish({
      type: 'channel/leave',
      content: { channel }
    })
  }
})
```

Alternatively, you can read the `setupCabal` and `swarm` methods in `./index.js`, and the `fromHypercore` method in [pouchdb-hypercore](https://github.com/garbados/pouchdb-hypercore/blob/master/index.js#L2-L21) to learn how to connect to a cabal yourself, so you can plug it into [your favorite database!](https://www.postgresql.org/)

## Install

Use [NPM](https://www.npmjs.com/):

```
$ npm i -S @garbados/pouchdb-cabal
```

## Usage

The plugin adds and modifies the following methods to a PouchDB instance:

### `async update(doc) -> Promise(<null>)`

Update a document without providing a `_rev` if it differs from the version on disk. This is used on startup to ensure that the database has the latest versions of its design documents.

### `async setupCabal(storage, key, opts = {}) -> Promise(<null>)`

Given the parameters to [create a multifeed](https://github.com/kappa-db/multifeed#var-multi--multifeedstorage-opts), attach and ready the objects needed to interact with a cabal. Must be run before interacting with cabal.

### `async getNick(key) -> Promise(<string>)`

Returns the latest nickname for the given hypercore.

### `async getFlags(key) -> Promise(<{ string: [string] }>)`

Returns the current flags for a given hypercore as an object whose keys are hypercore keys and whose values are lists of flags. For example:

```js
const result = await db.getFlags('...')
console.log(result)
>>> { '{key}': ['mod'] }
````

### `async getChannel(name, opts = {}) -> Promise(<[object]>)`

Retrieve messages in a given channel `name` from earliest to most recent. Results look like this:

```
{
	"_id": "{key}@{seq}",
	"_rev": ".-...",
	".key": "{key-whomst-posted}",
	".seq": {log-entry-number},
	"type": "chat/text",
	"content": {
		"channel": "rituals",
		"text": "we are gathered here today to pray cthulhu eats us first"
	},
	"timestamp": 123456789
}
```

`opts` is passed to [db.query](https://pouchdb.com/api.html#query_database). You can use `limit` to control how many results are returned at once, and you can use `startkey` and `endkey` to paginate by timestamp.

### `async getChannelRecent(name, opts = {}) -> Promise(<[object]>)`

As `getChannel` but sorts from most recent to the earliest.

### `async publish(message) -> Promise(<number>)`

Publish a message to the multifeed. This can be a message of any type. A timestamp is added before the message is appended to the log. The message will subsequently be saved to PouchDB. The promise resolves to the sequence number of the published message.

### `async publishNick(nick) -> Promise(<number>)`

Publish a `about` message to the multifeed identifying yourself with a nickname `nick`. The promise resolves to the sequence number of the published message.

### `async publishText(channel, text) -> Promise(<number>)`

Publish a `chat/text` message to the multifeed, posting the string `text` to the channel `channel`. The promise resolves to the sequence number of the published message.

### `async publishTopic(channel, text) -> Promise(<number>)`

Publish a `chat/topic` message to the multifeed, posting the string `text` as the topic of channel `channel`. The promise resolves to the sequence number of the published message.

### `async swarm(opts = {}) -> Promise(<null>)`

Join the swarm for the cabal and begin downloading blocks. `opts` is passed directly to [hyperswarm](https://github.com/hyperswarm/hyperswarm#swarm--hyperswarmoptions).

### `async close() -> Promise(<null>)`

Halt peering the multifeed and close open file handles.

### `async destroy(opts = {}) -> Promise(<null>)`

Wraps [db.destroy](https://pouchdb.com/api.html#delete_database) to also halt peering any hypercores and close any open file handles.

## Usage, Advanced

If you know your way around CouchDB design documents, you can check out the design documents used to index users, messages, flags, etc., in order to use [db.query()](https://pouchdb.com/api.html#query_database) to make advanced queries against this data. You can also use `db.update()` to add your own design documents in your own plugin.

## Test

`npm test`

## License

[Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0)
