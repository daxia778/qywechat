import client from './client'

export const welcomeAPI = {
  list(params) {
    return client.get('/admin/welcome_templates', { params })
  },

  create(data) {
    return client.post('/admin/welcome_templates', data)
  },

  update(id, data) {
    return client.put(`/admin/welcome_templates/${id}`, data)
  },

  delete(id) {
    return client.delete(`/admin/welcome_templates/${id}`)
  },
}
