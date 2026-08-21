import QRCode from 'qrcode';

/**
 * Utilitário para formatar campos EMV padrão BACEN (ID + Length + Value)
 */
function formatEMV(id, value) {
  const str = String(value || '');
  const len = String(str.length).padStart(2, '0');
  return `${id}${len}${str}`;
}

/**
 * Remove acentos e caracteres especiais para conformidade estrita com o padrão BACEN
 */
function sanitizeText(str, maxLength = 25) {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove acentos
    .replace(/[^a-zA-Z0-9 ]/g, '')   // Apenas alfanuméricos e espaços
    .trim()
    .slice(0, maxLength)
    .toUpperCase();
}

/**
 * Cálculo oficial de CRC16-CCITT (Polinômio 0x1021, Init 0xFFFF) conforme especificação do Banco Central do Brasil
 */
export function calculateCRC16(payload) {
  let crc = 0xFFFF;
  const polynomial = 0x1021;

  for (let i = 0; i < payload.length; i++) {
    crc ^= (payload.charCodeAt(i) << 8);
    for (let bit = 0; bit < 8; bit++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ polynomial) & 0xFFFF;
      } else {
        crc = (crc << 1) & 0xFFFF;
      }
    }
  }

  return (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Gera o payload PIX Copia e Cola padrão BR Code oficial do BACEN
 */
export function generatePixPayload({
  pixKey,
  merchantName = 'SST PRO SISTEMAS',
  merchantCity = 'SAO PAULO',
  amount = 149.90,
  txId = 'SSTPRO149'
}) {
  if (!pixKey) {
    throw new Error('Chave PIX é obrigatória para gerar o código de pagamento.');
  }

  const cleanPixKey = String(pixKey).trim();
  const cleanName = sanitizeText(merchantName, 25) || 'SST PRO SISTEMAS';
  const cleanCity = sanitizeText(merchantCity, 15) || 'SAO PAULO';
  const cleanTxId = sanitizeText(txId, 25) || 'SSTPRO149';
  const formattedAmount = Number(amount).toFixed(2);

  // 1. Merchant Account Information (Tag 26)
  const gui = formatEMV('00', 'br.gov.bcb.pix');
  const key = formatEMV('01', cleanPixKey);
  const merchantAccountInfo = formatEMV('26', `${gui}${key}`);

  // 2. Montagem dos campos EMV
  let rawPayload = [
    formatEMV('00', '01'),                         // Payload Format Indicator
    merchantAccountInfo,                            // Merchant Account Info (GUI + Chave)
    formatEMV('52', '0000'),                       // Merchant Category Code
    formatEMV('53', '986'),                        // Moeda: Real Brasileiro (986)
    formatEMV('54', formattedAmount),              // Valor da Transação
    formatEMV('58', 'BR'),                         // Código do País
    formatEMV('59', cleanName),                    // Nome do Beneficiário
    formatEMV('60', cleanCity),                    // Cidade do Beneficiário
    formatEMV('62', formatEMV('05', cleanTxId)),   // Additional Data Field (TxID)
    '6304'                                         // CRC16 Header (Tag 63, Len 04)
  ].join('');

  // 3. Cálculo do Checksum CRC16
  const checksum = calculateCRC16(rawPayload);
  const fullPixCode = `${rawPayload}${checksum}`;

  return {
    pixCode: fullPixCode,
    amount: Number(formattedAmount),
    merchantName: cleanName,
    merchantCity: cleanCity,
    txId: cleanTxId,
    pixKey: cleanPixKey
  };
}

/**
 * Gera imagem QR Code real em Base64 Data URL
 */
export async function generatePixQRCodeDataURL(pixPayloadString, options = {}) {
  const qrOptions = {
    errorCorrectionLevel: 'M',
    type: 'image/png',
    quality: 0.95,
    margin: 2,
    width: options.width || 300,
    color: {
      dark: '#0f172a',
      light: '#ffffff'
    }
  };

  return await QRCode.toDataURL(pixPayloadString, qrOptions);
}
