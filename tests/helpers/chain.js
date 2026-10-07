// tests/helpers/chain.js
// Tiny fake of a Mongoose Query: supports the chainable methods the controllers use
// and resolves to `result` when awaited.  query(x).populate().select().lean() → x

const query = (result) => {
  const q = {
    populate: () => q,
    select: () => q,
    lean: () => q,
    sort: () => q,
    skip: () => q,
    limit: () => q,
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    catch: (reject) => Promise.resolve(result).catch(reject),
  };
  return q;
};

module.exports = { query };
