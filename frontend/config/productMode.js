const { CODEARENA_PRODUCT_MODE } = require('../../shared/codearenaProductMode')

export const consumerProduct = CODEARENA_PRODUCT_MODE.consumer

export function isConsumerFeatureEnabled(feature) {
  return consumerProduct.coreFeatures[feature] === true ||
    consumerProduct.optionalFeatures[feature] === true
}
