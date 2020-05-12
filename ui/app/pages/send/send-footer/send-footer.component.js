import React, { Component } from 'react'
import PropTypes from 'prop-types'
import PageContainerFooter from '../../../components/ui/page-container/page-container-footer'
import {
  CONFIRM_TRANSACTION_ROUTE,
  DEFAULT_ROUTE,
} from '../../../helpers/constants/routes'

export default class SendFooter extends Component {
  static propTypes = {
    addToAddressBookIfNew: PropTypes.func,
    amount: PropTypes.string,
    data: PropTypes.string,
    clearSend: PropTypes.func,
    editingTransactionId: PropTypes.string,
    from: PropTypes.object,
    storageLimit: PropTypes.string,
    gasLimit: PropTypes.string,
    gasPrice: PropTypes.string,
    gasTotal: PropTypes.string,
    history: PropTypes.object,
    inError: PropTypes.bool,
    selectedToken: PropTypes.object,
    sign: PropTypes.func,
    to: PropTypes.string,
    toAccounts: PropTypes.array,
    tokenBalance: PropTypes.string,
    unapprovedTxs: PropTypes.object,
    update: PropTypes.func,
    sendErrors: PropTypes.object,
    gasEstimateType: PropTypes.string,
    gasIsLoading: PropTypes.bool,
    sponsorshipInfoIsLoading: PropTypes.bool,
  }

  static contextTypes = {
    t: PropTypes.func,
    metricsEvent: PropTypes.func,
  }

  onCancel () {
    this.props.clearSend()
    this.props.history.push(DEFAULT_ROUTE)
  }

  onSubmit (event) {
    event.preventDefault()
    const {
      addToAddressBookIfNew,
      amount,
      data,
      editingTransactionId,
      from: { address: from },
      gasLimit: gas,
      gasPrice,
      storageLimit,
      selectedToken,
      sign,
      to,
      unapprovedTxs,
      // updateTx,
      update,
      toAccounts,
      history,
      gasEstimateType,
    } = this.props
    const { metricsEvent } = this.context

    // Should not be needed because submit should be disabled if there are errors.
    // const noErrors = !amountError && toError === null

    // if (!noErrors) {
    //   return
    // }

    // TODO: add nickname functionality
    addToAddressBookIfNew(to, toAccounts)
    const promise = editingTransactionId
      ? update({
        amount,
        data,
        editingTransactionId,
        from,
        gas,
        gasPrice,
        storageLimit,
        selectedToken,
        to,
        unapprovedTxs,
      })
      : sign({ data, selectedToken, to, amount, from, gas, gasPrice, storageLimit })

    Promise.resolve(promise).then(() => {
      metricsEvent({
        eventOpts: {
          category: 'Transactions',
          action: 'Edit Screen',
          name: 'Complete',
        },
        customVariables: {
          gasChanged: gasEstimateType,
        },
      })
      history.push(CONFIRM_TRANSACTION_ROUTE)
    })
  }

  formShouldBeDisabled () {
    const {
      data,
      inError,
      selectedToken,
      tokenBalance,
      gasTotal,
      to,
      gasLimit,
      gasIsLoading,
      sponsorshipInfoIsLoading,
    } = this.props
    const missingTokenBalance = selectedToken && !tokenBalance
    const gasLimitTooLow = gasLimit < 5208 // 5208 is hex value of 21000, minimum gas limit
    const shouldBeDisabled =
      inError ||
      !gasTotal ||
      missingTokenBalance ||
      !(data || to) ||
      gasLimitTooLow ||
      gasIsLoading ||
      sponsorshipInfoIsLoading
    return shouldBeDisabled
  }

  componentDidUpdate (prevProps) {
    const { inError, sendErrors } = this.props
    const { metricsEvent } = this.context
    if (!prevProps.inError && inError) {
      const errorField = Object.keys(sendErrors).find((key) => sendErrors[key])
      const errorMessage = sendErrors[errorField]

      metricsEvent({
        eventOpts: {
          category: 'Transactions',
          action: 'Edit Screen',
          name: 'Error',
        },
        customVariables: {
          errorField,
          errorMessage,
        },
      })
    }
  }

  render () {
    return (
      <PageContainerFooter
        onCancel={() => this.onCancel()}
        onSubmit={(e) => this.onSubmit(e)}
        disabled={this.formShouldBeDisabled()}
      />
    )
  }
}
