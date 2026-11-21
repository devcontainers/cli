project('generate-dockerfile', 'c')

conf = configuration_data()
conf.set('BASE_IMAGE', 'node:22-bookworm')
conf.set('APP_PORT', '3000')

configure_file(
  input: 'Dockerfile.in',
  output: 'Dockerfile',
  configuration: conf
)