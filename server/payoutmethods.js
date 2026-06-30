'use strict';

const cards = require('./cards');

const BRAND_LABEL = { visa: 'Visa', mastercard: 'Mastercard', amex: 'Amex', discover: 'Discover', unknown: 'Card' };

/**
 * Validate + build a safe payout method (debit card or bank account). Only
 * last4 / brand / routing are stored — never the full card or account number.
 * Throws { status, message } on invalid input. Shared by merchant and owner payouts.
 */
function buildPayoutMethod(input = {}) {
  const type = input.type === 'card' ? 'card' : 'bank';

  if (type === 'card') {
    const number = String(input.number || '').replace(/\D/g, '');
    if (!cards.luhnValid(number)) throw { status: 400, message: 'Enter a valid debit card number.' };
    const month = Number(input.exp_month);
    const year = Number(input.exp_year);
    if (!month || month < 1 || month > 12) throw { status: 400, message: 'Enter a valid expiry month.' };
    if (!year) throw { status: 400, message: 'Enter a valid expiry year.' };
    const fullYear = year < 100 ? 2000 + year : year;
    const brand = cards.detectBrand(number);
    const last4 = number.slice(-4);
    return { type: 'card', brand, last4, expMonth: month, expYear: fullYear, holderName: String(input.name || '').trim(), label: `${BRAND_LABEL[brand] || 'Card'} debit ••${last4}` };
  }

  const account = String(input.accountNumber || '').replace(/\D/g, '');
  const routing = String(input.routingNumber || '').replace(/\D/g, '');
  if (account.length < 4) throw { status: 400, message: 'Enter a valid account number.' };
  if (routing.length !== 9) throw { status: 400, message: 'Routing number must be 9 digits.' };
  const last4 = account.slice(-4);
  const bankName = String(input.bankName || '').trim();
  return { type: 'bank', bankName, last4, routing, holderName: String(input.name || '').trim(), label: `${bankName || 'Bank account'} ••${last4}` };
}

module.exports = { buildPayoutMethod };
