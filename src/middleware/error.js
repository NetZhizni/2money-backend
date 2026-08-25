const error = async (error, req, res, next) => {
  const errorResponse = {
    name: `${error?.name}`,
    message: `${error?.message}`,
    stack: `${error?.stack}`,
  }
  res.status(error?.status || 400).json(errorResponse)
}

export default error
