/* global emit */
const crypto = require('hypercore-crypto')
const hyperswarm = require('hyperswarm')
const isEqual = require('lodash.isequal')
const multifeed = require('multifeed')
const pump = require('pump')

const PouchHypercore = require('@garbados/pouchdb-hypercore')

const META = {
  _id: '_design/meta',
  views: {
    types: {
      map: function (doc) {
        emit(doc.type)
      }.toString(),
      reduce: '_count'
    }
  }
}

const USERS = {
  _id: '_design/users',
  views: {
    nicks: {
      map: function (doc) {
        if (doc.type === 'about') {
          emit([doc.content.name, doc['.key'], doc['.seq']])
        }
      }.toString(),
      reduce: '_count'
    },
    nicksByFeed: {
      map: function (doc) {
        if (doc.type === 'about') {
          emit([doc['.key'], doc['.seq']], doc.content.name)
        }
      }.toString(),
      reduce: '_count'
    },
    flagsBySource: {
      map: function (doc) {
        if (doc.type.indexOf('flags') === 0) {
          for (var i = 0; i < doc.content.flags.length; i++) {
            var flag = doc.content.flags[i]
            emit([doc['.key'], doc['.seq'], doc.content.id, doc.type, flag])
          }
        }
      }.toString(),
      reduce: '_count'
    },
    flagsByTarget: {
      map: function (doc) {
        if (doc.type.indexOf('flags') === 0) {
          for (var i = 0; i < doc.content.flags.length; i++) {
            var flag = doc.content.flags[i]
            emit([doc.content.id, doc['.key'], doc['.seq'], doc.type, flag])
          }
        }
      }.toString(),
      reduce: '_count'
    }
  }
}

const CHANNELS = {
  _id: '_design/channels',
  views: {
    channels: {
      map: function (doc) {
        if (doc.type.indexOf('chat') === 0) {
          emit([doc.content.channel, doc.timestamp])
        }
      }.toString(),
      _reduce: '_count'
    }
  }
}

module.exports = function (PouchDB) {
  PouchDB.plugin(PouchHypercore)
  PouchDB.plugin({
    update: async function (doc) {
      try {
        const { _rev: rev, ...oldDoc } = await this.get(doc._id)
        if (doc._rev === rev) {
          await this.put(doc)
        } else if (isEqual(oldDoc, doc)) {
          // no update necessary
        } else {
          doc._rev = rev
          await this.put(doc)
        }
      } catch (error) {
        if (error.message === 'missing') {
          await this.put(doc)
        } else {
          throw error
        }
      }
    },
    setupCabal: async function (storage, key, opts = {}) {
      // setup multifeed
      if (typeof key === 'string') {
        key = Buffer.from(key, 'hex')
      }
      this._log_key = key
      this._logs = multifeed(storage, { encryptionKey: key, valueEncoding: 'json', ...opts })
      this._local = await new Promise((resolve, reject) => {
        this._logs.writer('local', (err, feed) => {
          if (err) { reject(err) } else { resolve(feed) }
        })
      })
      await this.fromMultifeed(this._logs, opts)
      const ddocPromises = [META, USERS, CHANNELS].map((ddoc) => { return this.update(ddoc) })
      await Promise.all(ddocPromises)
    },
    getNick: async function (key) {
      const result = await this.query('users/nicksByFeed', { startkey: [key], endkey: [`${key}\uffff`] })
      if (result.rows.length === 0) { throw new Error(`Could not find nick for key ${key}`) }
      return result.rows[0].value
    },
    getFlags: async function (key) {
      const result = await this.query('users/flagsByTarget', {
        reduce: false,
        include_docs: true,
        startkey: [`${key}\uffff`],
        endkey: [key],
        descending: true
      })
      const flags = {}
      for (const { doc } of result.rows) {
        const key = doc['.key']
        if (!flags[key]) { flags[key] = [] }
        if (doc.type === 'flags/add') {
          for (const flag of doc.content.flags) {
            flags[key].push(flag)
          }
        } else {
          // flags/remove
          for (const flag of doc.content.flags) {
            const i = flags[key].indexOf(flag)
            if (i !== -1) flags[key].splice(i, 1)
          }
        }
      }
      return flags
    },
    getChannel: async function (name, opts = {}) {
      const startkey = [name, opts.startkey]
      const endkey = [`${name}\uffff`, opts.endkey]
      if (opts.descending) {
        opts = { startkey: endkey, endkey: startkey, ...opts }
      } else {
        opts = { startkey, endkey, ...opts }
      }
      const result = await this.query('channels/channels', {
        include_docs: true,
        ...opts
      })
      return result.rows.map(({ doc }) => { return doc })
    },
    getChannelRecent: async function (name, opts = {}) {
      return this.getChannel(name, { descending: true, ...opts })
    },
    // publishing methods
    publish: async function (message) {
      return new Promise((resolve, reject) => {
        this._local.append({ ...message, timestamp: Date.now() }, (err, seq) => {
          if (err) { reject(err) } else { resolve(seq) }
        })
      })
    },
    publishNick: async function (nick) {
      return this.publish({
        type: 'about',
        content: { name: nick }
      })
    },
    publishText: async function (channel, text) {
      return this.publish({
        type: 'chat/text',
        content: { text, channel }
      })
    },
    publishTopic: async function (channel, text) {
      return this.publish({
        type: 'chat/topic',
        content: { text, channel }
      })
    },
    // built-in swarming!
    swarm: function (opts = {}) {
      const swarm = hyperswarm(opts)
      // set up swarm
      swarm.join(crypto.discoveryKey(this._log_key), { lookup: true, announce: true })
      this._log_swarm = swarm
      swarm.on('connection', (socket, info) => {
        let remoteKey

        var r = this._logs.replicate(info.client)
        pump(socket, r, socket, (err) => {
          if (err) this.emit('swarm-error', err)
        })

        if (!r.registerExtension) { return }
        const ext = r.registerExtension('peer-id', {
          encoding: 'json',
          onmessage (message, peer) {
            if (remoteKey) return
            if (!message.id) return
            const buf = Buffer.from(message.id, 'hex')
            if (!buf || buf.length !== 32) return
            remoteKey = message.id
          }
        })
        ext.send({ id: this._local.key.toString('hex') })
      })
    }
  })
  // wrap destroy to also close multifeed
  const destroy = PouchDB.prototype.destroy
  PouchDB.prototype.close = async function () {
    if (this._log_swarm) await new Promise((resolve) => { this._log_swarm.destroy(resolve) })
    if (this._logs) await new Promise((resolve) => { this._logs.close(resolve) })
  }
  PouchDB.prototype.destroy = async function (opts = {}, callback) {
    if (typeof opts === 'function') { return this.destroy({}, opts) }
    await this.close()
    return callback ? destroy.call(this, opts, callback) : destroy.call(this, opts)
  }
}
