'use client';
import { gql, useQuery, useMutation } from "@apollo/client";
import { 
  Table, 
  Button, 
  Space, 
  Tag, 
  Modal, 
  Form, 
  Input, 
  Switch, 
  message, 
  Popconfirm,
  Alert,
  Tooltip
} from "antd";
import { useState, useMemo } from "react";
import { PlusOutlined, EditOutlined, DeleteOutlined, CheckCircleOutlined, StopOutlined } from "@ant-design/icons";

// TypeScript Types
type Role = {
  id: string;
  name: string;
  description?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  user_count: number;
};

type RoleFormData = {
  name: string;
  description?: string;
  is_active: boolean;
};

// GraphQL Operations
const Q_ROLES = gql`
  query {
    roles {
      id
      name
      description
      is_active
      created_at
      updated_at
      user_count
    }
  }
`;

const M_CREATE_ROLE = gql`
  mutation CreateRole($input: CreateRoleInput!) {
    createRole(input: $input) {
      id
      name
      description
      is_active
      created_at
      updated_at
      user_count
    }
  }
`;

const M_UPDATE_ROLE = gql`
  mutation UpdateRole($id: ID!, $input: UpdateRoleInput!) {
    updateRole(id: $id, input: $input) {
      id
      name
      description
      is_active
      created_at
      updated_at
      user_count
    }
  }
`;

const M_DELETE_ROLE = gql`
  mutation DeleteRole($id: ID!) {
    deleteRole(id: $id)
  }
`;

const M_SET_ROLE_ACTIVE = gql`
  mutation SetRoleActive($id: ID!, $is_active: Boolean!) {
    setRoleActive(id: $id, is_active: $is_active) {
      id
      name
      description
      is_active
      created_at
      updated_at
      user_count
    }
  }
`;

function RolesManagement() {
  const [form] = Form.useForm();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);

  // Query all roles
  const { data, loading, error, refetch } = useQuery(Q_ROLES, {
    fetchPolicy: "cache-and-network",
  });

  // Mutations
  const [createRole, { loading: creating }] = useMutation(M_CREATE_ROLE, {
    onCompleted: () => {
      message.success('Role created successfully');
      setIsModalOpen(false);
      form.resetFields();
      refetch();
    },
    onError: (err) => {
      message.error(err.message || 'Failed to create role');
    },
  });

  const [updateRole, { loading: updating }] = useMutation(M_UPDATE_ROLE, {
    onCompleted: () => {
      message.success('Role updated successfully');
      setIsModalOpen(false);
      setEditingRole(null);
      form.resetFields();
      refetch();
    },
    onError: (err) => {
      message.error(err.message || 'Failed to update role');
    },
  });

  const [deleteRole] = useMutation(M_DELETE_ROLE, {
    onCompleted: () => {
      message.success('Role deleted successfully');
      refetch();
    },
    onError: (err) => {
      message.error(err.message || 'Failed to delete role');
    },
  });

  const [setRoleActive] = useMutation(M_SET_ROLE_ACTIVE, {
    onCompleted: (data) => {
      const role = data?.setRoleActive;
      const status = role?.is_active ? 'activated' : 'deactivated';
      message.success(`Role ${status} successfully`);
      refetch();
    },
    onError: (err) => {
      message.error(err.message || 'Failed to change role status');
    },
  });

  const roles: Role[] = data?.roles || [];

  // Open create modal
  const handleCreate = () => {
    setEditingRole(null);
    form.resetFields();
    form.setFieldsValue({ is_active: true }); // Default to active
    setIsModalOpen(true);
  };

  // Open edit modal
  const handleEdit = (role: Role) => {
    setEditingRole(role);
    form.setFieldsValue({
      name: role.name,
      description: role.description || '',
      is_active: role.is_active,
    });
    setIsModalOpen(true);
  };

  // Submit form (create or update)
  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const input: RoleFormData = {
        name: values.name.trim(),
        description: values.description?.trim() || null,
        is_active: values.is_active,
      };

      if (editingRole) {
        // Update existing role
        await updateRole({
          variables: {
            id: editingRole.id,
            input,
          },
        });
      } else {
        // Create new role
        await createRole({
          variables: { input },
        });
      }
    } catch (err) {
      // Form validation errors are handled by Ant Design
      console.error('Form validation failed:', err);
    }
  };

  // Toggle role active status
  const handleToggleActive = (role: Role) => {
    const newStatus = !role.is_active;
    const action = newStatus ? 'activate' : 'deactivate';

    Modal.confirm({
      title: `${action.charAt(0).toUpperCase() + action.slice(1)} Role`,
      content: (
        <>
          <p>
            Are you sure you want to {action} the role <strong>"{role.name}"</strong>?
          </p>
          {!newStatus && role.user_count > 0 && (
            <Alert
              type="warning"
              message={`This role is currently assigned to ${role.user_count} user(s). Deactivating it will not affect existing users.`}
              showIcon
            />
          )}
        </>
      ),
      onOk: async () => {
        await setRoleActive({
          variables: {
            id: role.id,
            is_active: newStatus,
          },
        });
      },
    });
  };

  // Delete role
  const handleDelete = (role: Role) => {
    if (role.user_count > 0) {
      Modal.error({
        title: 'Cannot Delete Role',
        content: (
          <>
            <p>
              The role <strong>"{role.name}"</strong> is currently assigned to{' '}
              <strong>{role.user_count}</strong> user(s) and cannot be deleted.
            </p>
            <p>Please reassign these users to another role or deactivate the role instead.</p>
          </>
        ),
      });
      return;
    }

    Modal.confirm({
      title: 'Delete Role',
      content: (
        <>
          <p>
            Are you sure you want to permanently delete the role <strong>"{role.name}"</strong>?
          </p>
          <Alert
            type="warning"
            message="This action cannot be undone."
            showIcon
          />
        </>
      ),
      okButtonProps: { danger: true },
      okText: 'Delete',
      onOk: async () => {
        await deleteRole({
          variables: { id: role.id },
        });
      },
    });
  };

  // Table columns
  const columns = useMemo(
    () => [
      {
        title: 'Name',
        dataIndex: 'name',
        key: 'name',
        render: (name: string, record: Role) => (
          <Space>
            <strong>{name}</strong>
            {!record.is_active && (
              <Tag color="red">Inactive</Tag>
            )}
          </Space>
        ),
      },
      {
        title: 'Description',
        dataIndex: 'description',
        key: 'description',
        render: (desc: string | null) => desc || <span style={{ color: '#999' }}>—</span>,
      },
      {
        title: 'Status',
        dataIndex: 'is_active',
        key: 'is_active',
        width: 100,
        render: (is_active: boolean) =>
          is_active ? (
            <Tag icon={<CheckCircleOutlined />} color="success">
              Active
            </Tag>
          ) : (
            <Tag icon={<StopOutlined />} color="default">
              Inactive
            </Tag>
          ),
      },
      {
        title: 'Users',
        dataIndex: 'user_count',
        key: 'user_count',
        width: 100,
        align: 'center' as const,
        render: (count: number) => (
          <Tag color={count > 0 ? 'blue' : 'default'}>{count}</Tag>
        ),
      },
      {
        title: 'Created',
        dataIndex: 'created_at',
        key: 'created_at',
        width: 180,
        render: (date: string) => new Date(date).toLocaleString(),
      },
      {
        title: 'Updated',
        dataIndex: 'updated_at',
        key: 'updated_at',
        width: 180,
        render: (date: string) => new Date(date).toLocaleString(),
      },
      {
        title: 'Actions',
        key: 'actions',
        width: 200,
        render: (_: any, record: Role) => (
          <Space size="small">
            <Tooltip title="Edit role">
              <Button
                type="link"
                size="small"
                icon={<EditOutlined />}
                onClick={() => handleEdit(record)}
              >
                Edit
              </Button>
            </Tooltip>

            <Tooltip title={record.is_active ? 'Deactivate role' : 'Activate role'}>
              <Button
                type="link"
                size="small"
                onClick={() => handleToggleActive(record)}
              >
                {record.is_active ? 'Deactivate' : 'Activate'}
              </Button>
            </Tooltip>

            <Tooltip
              title={
                record.user_count > 0
                  ? `Cannot delete: ${record.user_count} user(s) assigned`
                  : 'Delete role'
              }
            >
              <Button
                type="link"
                size="small"
                danger
                icon={<DeleteOutlined />}
                disabled={record.user_count > 0}
                onClick={() => handleDelete(record)}
              >
                Delete
              </Button>
            </Tooltip>
          </Space>
        ),
      },
    ],
    []
  );

  // Error state
  if (error) {
    return (
      <Alert
        type="error"
        message="Error Loading Roles"
        description={error.message}
        showIcon
      />
    );
  }

  // Empty state
  const emptyState = !loading && roles.length === 0;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Role Management</h2>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={handleCreate}
          >
            Create Role
          </Button>
        </Space>
      </div>

      {/* Info Alert */}
      <Alert
        type="info"
        message="Roles define user permissions and access levels in the system."
        description="Users are assigned to roles via the normalized 'roles' table. Deactivating a role does not affect existing users."
        showIcon
        closable
        style={{ marginBottom: 16 }}
      />

      {/* Table */}
      <Table
        rowKey="id"
        loading={loading}
        dataSource={roles}
        columns={columns}
        pagination={{
          pageSize: 20,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50, 100],
          showTotal: (total) => `Total ${total} role(s)`,
        }}
        locale={{
          emptyText: emptyState ? (
            <div style={{ padding: '40px 0' }}>
              <p style={{ fontSize: 16, color: '#999' }}>No roles found</p>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={handleCreate}
              >
                Create First Role
              </Button>
            </div>
          ) : undefined,
        }}
      />

      {/* Create/Edit Modal */}
      <Modal
        title={editingRole ? 'Edit Role' : 'Create Role'}
        open={isModalOpen}
        onCancel={() => {
          setIsModalOpen(false);
          setEditingRole(null);
          form.resetFields();
        }}
        onOk={handleSubmit}
        confirmLoading={creating || updating}
        okText={editingRole ? 'Update' : 'Create'}
        width={600}
      >
        <Form
          form={form}
          layout="vertical"
          autoComplete="off"
        >
          <Form.Item
            label="Role Name"
            name="name"
            rules={[
              { required: true, message: 'Please enter a role name' },
              { min: 2, message: 'Role name must be at least 2 characters' },
              { max: 50, message: 'Role name cannot exceed 50 characters' },
              {
                pattern: /^[a-zA-Z0-9\s]+$/,
                message: 'Role name can only contain letters, numbers, and spaces',
              },
            ]}
          >
            <Input
              placeholder="e.g., Administrator, Moderator, Subscriber"
              maxLength={50}
              showCount
            />
          </Form.Item>

          <Form.Item
            label="Description"
            name="description"
            rules={[
              { max: 200, message: 'Description cannot exceed 200 characters' },
            ]}
          >
            <Input.TextArea
              placeholder="Brief description of this role's purpose"
              rows={3}
              maxLength={200}
              showCount
            />
          </Form.Item>

          <Form.Item
            label="Active Status"
            name="is_active"
            valuePropName="checked"
            tooltip="Inactive roles cannot be assigned to new users"
          >
            <Switch
              checkedChildren="Active"
              unCheckedChildren="Inactive"
            />
          </Form.Item>

          {editingRole && editingRole.user_count > 0 && (
            <Alert
              type="info"
              message={`This role is currently assigned to ${editingRole.user_count} user(s)`}
              showIcon
              style={{ marginBottom: 0 }}
            />
          )}
        </Form>
      </Modal>
    </div>
  );
}

export default function Page() {
  return <RolesManagement />;
}
