const algosdk = require('algosdk')
const { algoClient, algoIndexer } = require('../../../config/algorand')
const mailer = require('../../../utils/mailer')

async function fundUser(user, amount) {
  const algodClient = algoClient()
  const suggestedParams = await algodClient.getTransactionParams().do()
  const creator = algosdk.mnemonicToSecretKey(process.env.ALGO_MNEMONIC)

  const minimumFundsPaymentTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from: creator.addr,
    to: user.publicAddress,
    amount: algosdk.algosToMicroalgos(amount),
    suggestedParams: suggestedParams,
  })

  const signedTxn = minimumFundsPaymentTxn.signTxn(creator.sk)
  const txId = minimumFundsPaymentTxn.txID().toString()

  await algodClient.sendRawTransaction(signedTxn).do()
  await algosdk.waitForConfirmation(algodClient, txId, 3)
}

async function fundUserIfNew(user, amount = process.env.ALGOS_TO_NEW_USER) {
  const indexerClient = algoIndexer()
  try {
    const userAddress = await indexerClient.lookupAccountByID(user.publicAddress).do()
  } catch (e) {
    if (e.status !== 404) throw e
    console.log('Funding new user')
    await fundUser(user, Number(amount))
  }
}

module.exports = {
  lifecycles: {
    beforeCreate: async function (user) {
      if (user.publicAddress) await fundUserIfNew(user, process.env.ALGOS_TO_NEW_USER)
      if (user.issuer === 'magic-link') user.confirmed = true
    },
    beforeUpdate: async function (params, newUser) {
      const { _id } = params
      const oldUser = await strapi.db.query('plugins::users-permissions.user').findOne({ _id })
      if (oldUser.id !== _id) throw new Error(`User not found with id: ${_id}`)

      const changeListKeys = Object.keys(newUser)
      for (const key of changeListKeys) {
        const isPublicAddressChange = key === 'publicAddress'
        const isUsernameChange = key === 'username'
        const isIssuerChange = key === 'issuer'
        const isEmailChange = key === 'email'
        const isDifferent = newUser[key] !== oldUser[key]
        const wasPreviouslyUndefined = !oldUser[key]

        if (isPublicAddressChange && isDifferent) {
          await fundUserIfNew(newUser, process.env.ALGOS_TO_NEW_USER)
          continue
        }
        if (isEmailChange && isDifferent && oldUser['issuer'] !== 'magic-link') {
          newUser['confirmed'] = false
          newUser['confirmationToken'] = await mailer.sendVerificationMail(newUser.email, newUser.language)
        }
        if (isEmailChange && oldUser['issuer'] === 'magic-link' && !wasPreviouslyUndefined) delete newUser[key]
        if (isUsernameChange) delete newUser[key]
        if (isIssuerChange && !wasPreviouslyUndefined) delete newUser[key]
      }
    },
  },
}
