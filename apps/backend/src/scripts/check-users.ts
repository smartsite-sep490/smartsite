import 'reflect-metadata';
import dataSource from '../database/typeorm.data-source.js';

async function listUsers() {
  await dataSource.initialize();
  try {
    const users = await dataSource.query(`
      SELECT
        u.id,
        u.username,
        u.display_name,
        u.is_active,
        u.must_change_password,
        json_agg(json_build_object('role', r.role, 'site_id', r.site_id, 'contractor_id', r.contractor_id)) as roles
      FROM users u
      LEFT JOIN user_roles r ON r.user_id = u.id
      GROUP BY u.id, u.username, u.display_name, u.is_active, u.must_change_password
    `);
    console.log(JSON.stringify(users, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await dataSource.destroy();
  }
}

listUsers();
