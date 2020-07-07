/* global describe, it, before, after */

const assert = require('assert').strict
const PouchDB = require('pouchdb')
const rimraf = require('rimraf')
PouchDB.plugin(require('.'))

// default cabal key, the chill vibes dweb-irc
const CABAL_KEY = '1eef9ad64e284691b7c6f6310e39204b5f92765e36102046caaa6a7ff8c02d74'

describe('pouchdb-cabal', function () {
  before(async function () {
    this.timeout(0)
    this.db = new PouchDB(process.env.COUCH_URL ? `${process.env.COUCH_URL}/pouchdb-cabal-test` : '.testpouch')
    await this.db.setupCabal('.testcabal', CABAL_KEY)
    // swarm up!
    this.db.swarm()
    // catch up!
    await new Promise((resolve) => { setTimeout(resolve, 5 * 1000) })
  })

  after(async function () {
    this.timeout(0)
    if (process.env.COUCH_URL) {
      // don't destroy remote db, so user can play with the data
      await this.db.close()
    } else {
      await this.db.destroy()
      rimraf.sync('.testpouch')
    }
    rimraf.sync('.testcabal')
  })

  it('should sync', async function () {
    // check for types
    const result = await this.db.query('meta/types', { group: true })
    // ensure we got some `abouts` from other users
    assert(result.rows.filter(({ key }) => { return key === 'about' })[0].value > 0)
  })

  it('should get a nick', async function () {
    const about = await this.db.query('meta/types', { reduce: false, key: 'about', limit: 1, include_docs: true })
    const key = about.rows[0].doc['.key']
    const nick = await this.db.getNick(key)
    assert(nick)
  })

  it('should compile flags', async function () {
    const flagsResult = await this.db.query('meta/types', { reduce: false, key: 'flags/add', limit: 1, include_docs: true })
    const key = flagsResult.rows[0].doc.content.id
    const flags = await this.db.getFlags(key)
    assert(Object.keys(flags).length > 0)
  })

  it('should get messages from a channel', async function () {
    // first messages
    const results1 = await this.db.getChannel('default', { limit: 1 })
    const ts1 = results1[0].timestamp
    // most recent
    const results2 = await this.db.getChannelRecent('default', { limit: 1 })
    const ts2 = results2[0].timestamp
    // assert earlier messages happened first
    assert(ts1 < ts2)
  })

  it.skip('should publish a message', async function () {
    await this.db.publishNick('garbados-pouchdb-testbot')
    await this.db.publishText('test', 'it works!')
  })
})
