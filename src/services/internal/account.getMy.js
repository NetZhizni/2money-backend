import AccountRepository from '../../sql/account.repository.js'

const accountGetMy = async ({ body }) => {
  const { id: ownerId } = body.user

  const res = await AccountRepository.findAccount({
    // owner_id: ownerId,
  })
  return res
}

export default accountGetMy
