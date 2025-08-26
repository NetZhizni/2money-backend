import UserRepository from '../sql/user.repository.js'
import firebaseAdmin from '../util/firebaseAdmin.js'

const authGoogle = async (req, res, next) => {
  try {
    const authorization = req.headers?.authorization
    const token = authorization?.replace('Bearer ', '')
    const decodedToken = await firebaseAdmin.auth().verifyIdToken(token)
    const email = decodedToken?.email

    let userByEmail = await UserRepository.findByEmail(email)
    if (!userByEmail) {
      const name = decodedToken.name.split(' ')
      userByEmail = {
        last_name: name[0],
        first_name: name[1],
        email,
      }
      userByEmail = await UserRepository.createUser(userByEmail, decodedToken.picture)
    } else if (userByEmail.isNeedUpdatePhoto) {
      const picture = await UserRepository.updatePhoto({
        email,
        picture: decodedToken.picture,
      })
      await UserRepository.updateUser(userByEmail.id, { picture })
    }
    req.body = { user: userByEmail, ...req.body }
    return next()
  } catch (error) {
    res.status(401).json({
      name: `${error?.name}`,
      message: `${error?.message}`,
      stack: `${error?.stack}`,
    })
  }
}

export default authGoogle
