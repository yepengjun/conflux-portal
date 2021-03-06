import EthQuery from '../../ethjs-query'
import { hexToBn, BnMultiplyByFraction, bnToHex } from '../../lib/util'
import log from 'loglevel'
import { addHexPrefix, isValidContractAddress } from 'cfx-util'
import { SEND_ETHER_ACTION_KEY } from '../../../../ui/app/helpers/constants/transactions.js'

export const SIMPLE_GAS_COST = '0x5208' // Hex for 21000, cost of a simple send.
export const SIMPLE_STORAGE_COST = '0x0' // Hex for 0, cost of a simple send.

import { TRANSACTION_NO_CONTRACT_ERROR_KEY } from '../../../../ui/app/helpers/constants/error-keys'

/**
tx-gas-utils are gas utility methods for Transaction manager
its passed ethquery
and used to do things like calculate gas of a tx.
@param {Object} provider - A network provider.
*/

class TxGasUtil {
  constructor (provider) {
    this.query = new EthQuery(provider)
  }

  /**
    @param {Object} txMeta - the txMeta object
    @returns {Object} - the txMeta object with the gas written to the txParams
  */
  async analyzeGasUsage (txMeta, getCodeResponse) {
    const block = await this.query.getBlockByNumber('latest', false)
    let estimatedGasHex
    let estimatedStorageHex
    try {
      const {
        gasUsed,
        storageCollateralized,
      } = await this.estimateTxGasAndCollateral(
        txMeta,
        block.gasLimit,
        getCodeResponse
      )
      estimatedGasHex = gasUsed
      estimatedStorageHex = storageCollateralized
    } catch (err) {
      log.warn(err)
      txMeta.simulationFails = {
        reason: err.message,
        errorKey: err.errorKey,
        debug: { blockNumber: block.number, blockGasLimit: block.gasLimit },
      }

      if (err.errorKey === TRANSACTION_NO_CONTRACT_ERROR_KEY) {
        txMeta.simulationFails.debug.getCodeResponse = err.getCodeResponse
      }

      return txMeta
    }
    this.setTxGas(txMeta, block.gasLimit, {
      estimatedGasHex,
      estimatedStorageHex,
    })
    return txMeta
  }

  /**
    Estimates the tx's gas/storageLimit usage
    @param {Object} txMeta - the txMeta object
    @param {string} blockGasLimitHex - hex string of the block's gas limit
    @returns {string} - the estimated gas limit as a hex string
  */
  async estimateTxGasAndCollateral (txMeta, blockGasLimitHex, getCodeResponse) {
    // new unapproved tx will come here first
    const txParams = txMeta.txParams
    if (txParams.to && !isValidContractAddress(txParams.to)) {
      txMeta.simpleSend = true
    }

    // check if gasLimit is already specified
    txMeta.gasLimitSpecified = Boolean(txParams.gas)
    txMeta.storageLimitSpecified = Boolean(txParams.storageLimit)

    if (!txMeta.storageLimitSpecified) {
      txParams.storageLimit = SIMPLE_STORAGE_COST
      txMeta.storageLimitSpecified = true
    }

    // if it is, use that value
    if (txMeta.gasLimitSpecified && txMeta.storageLimitSpecified) {
      return { gasUsed: txParams.gas, storageCollateralized: txParams.storageLimit }
    }

    const recipient = txParams.to
    const hasRecipient = Boolean(recipient)

    // see if we can set the gas based on the recipient
    if (hasRecipient) {
      // For an address with no code, geth will return '0x', and ganache-core v2.2.1 will return '0x0'
      const categorizedAsSimple =
        txMeta.transactionCategory === SEND_ETHER_ACTION_KEY

      if (categorizedAsSimple) {
        // if there's data in the params, but there's no contract code, it's not a valid transaction
        if (txParams.data) {
          const err = new Error(
            'TxGasUtil - Trying to call a function on a non-contract address'
          )
          // set error key so ui can display localized error message
          err.errorKey = TRANSACTION_NO_CONTRACT_ERROR_KEY

          // set the response on the error so that we can see in logs what the actual response was
          err.getCodeResponse = getCodeResponse
          throw err
        }

        // This is a standard ether simple send, gas requirement is exactly 21k
        txParams.gas = SIMPLE_GAS_COST
        // prevents buffer addition
        txMeta.simpleSend = true
        return SIMPLE_GAS_COST
      }
    }

    // fallback to block gasLimit
    const blockGasLimitBN = hexToBn(blockGasLimitHex)
    const saferGasLimitBN = BnMultiplyByFraction(blockGasLimitBN, 19, 20)
    txParams.gas = bnToHex(saferGasLimitBN)

    // estimate tx gas requirements
    return await this.query.estimateGas(txParams)
  }

  /**
    Writes the gas/storage on the txParams in the txMeta
    @param {Object} txMeta - the txMeta object to write to
    @param {string} blockGasLimitHex - the block gas limit hex
    @param {string} estimatedGasHex - the estimated gas hex
  */
  setTxGas (txMeta, blockGasLimitHex, { estimatedGasHex, estimatedStorageHex }) {
    txMeta.estimatedGas = addHexPrefix(estimatedGasHex)
    txMeta.estimatedStorage = addHexPrefix(estimatedStorageHex)
    const txParams = txMeta.txParams

    if (txMeta.simpleSend) {
      txMeta.estimatedGas = txParams.gas
      txMeta.estimatedStorage = SIMPLE_STORAGE_COST
      return
    }

    if (txMeta.storageLimitSpecified) {
      txMeta.estimatedStorage = txParams.storageLimit
    }

    // if gasLimit was specified and doesnt OOG,
    // use original specified amount
    if (txMeta.gasLimitSpecified) {
      txMeta.estimatedGas = txParams.gas
      return
    }

    // if gasLimit not originally specified,
    // try adding an additional gas buffer to our estimation for safety
    const recommendedGasHex = this.addGasBuffer(
      txMeta.estimatedGas,
      blockGasLimitHex
    )
    txParams.gas = recommendedGasHex

    if (!txMeta.storageLimitSpecified) {
      txParams.storageLimit = txMeta.estimatedStorage
    }
    return
  }

  /**
    Adds a gas buffer with out exceeding the block gas limit

    @param {string} initialGasLimitHex - the initial gas limit to add the buffer too
    @param {string} blockGasLimitHex - the block gas limit
    @returns {string} - the buffered gas limit as a hex string
  */
  addGasBuffer (initialGasLimitHex, blockGasLimitHex) {
    const initialGasLimitBn = hexToBn(initialGasLimitHex)
    const blockGasLimitBn = hexToBn(blockGasLimitHex)
    const upperGasLimitBn = blockGasLimitBn.muln(0.9)
    const bufferedGasLimitBn = initialGasLimitBn.muln(1.5)

    // if initialGasLimit is above blockGasLimit, dont modify it
    if (initialGasLimitBn.gt(upperGasLimitBn)) {
      return bnToHex(initialGasLimitBn)
    }
    // if bufferedGasLimit is below blockGasLimit, use bufferedGasLimit
    if (bufferedGasLimitBn.lt(upperGasLimitBn)) {
      return bnToHex(bufferedGasLimitBn)
    }
    // otherwise use blockGasLimit
    return bnToHex(upperGasLimitBn)
  }
}

export default TxGasUtil
