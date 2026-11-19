"use client";

import { useUiText } from "@/lib/useUiText";
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
  const uiText = useUiText();
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
      message.success(uiText("admin_ui.en_role_created_successfully_150cd"));
      setIsModalOpen(false);
      form.resetFields();
      refetch();
    },
    onError: (err) => {
      message.error(err.message || uiText("admin_ui.en_failed_to_create_role_6edfd"));
    },
  });

  const [updateRole, { loading: updating }] = useMutation(M_UPDATE_ROLE, {
    onCompleted: () => {
      message.success(uiText("admin_ui.en_role_updated_successfully_87ea8"));
      setIsModalOpen(false);
      setEditingRole(null);
      form.resetFields();
      refetch();
    },
    onError: (err) => {
      message.error(err.message || uiText("admin_ui.en_failed_to_update_role_2bce8"));
    },
  });

  const [deleteRole] = useMutation(M_DELETE_ROLE, {
    onCompleted: () => {
      message.success(uiText("admin_ui.en_role_deleted_successfully_b714d"));
      refetch();
    },
    onError: (err) => {
      message.error(err.message || uiText("admin_ui.en_failed_to_delete_role_373bd"));
    },
  });

  const [setRoleActive] = useMutation(M_SET_ROLE_ACTIVE, {
    onCompleted: (data) => {
      const role = data?.setRoleActive;
      const status = role?.is_active ? uiText("admin_ui.role_activated") : uiText("admin_ui.role_deactivated");
      message.success(status);
      refetch();
    },
    onError: (err) => {
      message.error(err.message || uiText("admin_ui.en_failed_to_change_role_status_894a7"));
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
    const action = newStatus ? uiText("admin_ui.en_activate_92ef0") : uiText("admin_ui.en_deactivate_d65de");

    Modal.confirm({
      title: uiText("admin_ui.en_role_027e2", { v0: action.charAt(0).toUpperCase() + action.slice(1) }),
      content: (
        <>
          <p>
            {uiText("admin_ui.en_are_you_sure_you_want_to_ffc98")} {action}  {uiText("admin_ui.en_the_role_fd65e")} <strong>"{role.name}"</strong>?
          </p>
          {!newStatus && role.user_count > 0 && (
            <Alert closable
              type="warning"
              message={uiText("admin_ui.en_this_role_is_currently_assigned_to_user_s_9b044", { v0: role.user_count })}
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
        title: uiText("admin_ui.en_cannot_delete_role_f3db4"),
        content: (
          <>
            <p>
              {uiText("admin_ui.en_the_role_0423e")} <strong>"{role.name}"</strong>  {uiText("admin_ui.en_is_currently_assigned_to_ee3c9")}{' '}
              <strong>{role.user_count}</strong>  {uiText("admin_ui.en_user_s_and_cannot_be_deleted_d99be")}</p>
            <p>{uiText("admin_ui.en_please_reassign_these_users_to_another_role_or_b2e5f")}</p>
          </>
        ),
      });
      return;
    }

    Modal.confirm({
      title: uiText("admin_ui.en_delete_role_af587"),
      content: (
        <>
          <p>
            {uiText("admin_ui.en_are_you_sure_you_want_to_permanently_delete_4adde")} <strong>"{role.name}"</strong>?
          </p>
          <Alert closable
            type="warning"
            message={uiText("admin_ui.en_this_action_cannot_be_undone_951f4")}
            showIcon
          />
        </>
      ),
      okButtonProps: { danger: true },
      okText: uiText("admin_ui.en_delete_f6fdb"),
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
        title: uiText("admin_ui.en_name_709a2"),
        dataIndex: 'name',
        key: 'name',
        render: (name: string, record: Role) => (
          <Space>
            <strong>{name}</strong>
            {!record.is_active && (
              <Tag color="red">{uiText("admin_ui.en_inactive_09af5")}</Tag>
            )}
          </Space>
        ),
      },
      {
        title: uiText("admin_ui.en_description_55f8e"),
        dataIndex: 'description',
        key: 'description',
        render: (desc: string | null) => desc || <span style={{ color: '#999' }}>—</span>,
      },
      {
        title: uiText("admin_ui.en_status_bae7d"),
        dataIndex: 'is_active',
        key: 'is_active',
        width: 100,
        render: (is_active: boolean) =>
          is_active ? (
            <Tag icon={<CheckCircleOutlined />} color="success">
              {uiText("admin_ui.en_active_a733b")}</Tag>
          ) : (
            <Tag icon={<StopOutlined />} color="default">
              {uiText("admin_ui.en_inactive_09af5")}</Tag>
          ),
      },
      {
        title: uiText("admin_ui.en_users_57f2b"),
        dataIndex: 'user_count',
        key: 'user_count',
        width: 100,
        align: 'center' as const,
        render: (count: number) => (
          <Tag color={count > 0 ? 'blue' : 'default'}>{count}</Tag>
        ),
      },
      {
        title: uiText("admin_ui.en_created_accf4"),
        dataIndex: 'created_at',
        key: 'created_at',
        width: 180,
        render: (date: string) => new Date(date).toLocaleString(uiText.locale),
      },
      {
        title: uiText("admin_ui.en_updated_f2f85"),
        dataIndex: 'updated_at',
        key: 'updated_at',
        width: 180,
        render: (date: string) => new Date(date).toLocaleString(uiText.locale),
      },
      {
        title: uiText("admin_ui.en_actions_c3cd6"),
        key: 'actions',
        width: 200,
        render: (_: any, record: Role) => (
          <Space size="small">
            <Tooltip title={uiText("admin_ui.en_edit_role_61dd6")}>
              <Button
                type="link"
                size="small"
                icon={<EditOutlined />}
                onClick={() => handleEdit(record)}
              >
                {uiText("admin_ui.en_edit_53016")}</Button>
            </Tooltip>

            <Tooltip title={record.is_active ? uiText("admin_ui.en_deactivate_role_bcd3d") : uiText("admin_ui.en_activate_role_8f7de")}>
              <Button
                type="link"
                size="small"
                onClick={() => handleToggleActive(record)}
              >
                {record.is_active ? uiText("admin_ui.en_deactivate_d65de") : uiText("admin_ui.en_activate_92ef0")}
              </Button>
            </Tooltip>

            <Tooltip
              title={
                record.user_count > 0
                  ? uiText("admin_ui.en_cannot_delete_user_s_assigned_bff97", { v0: record.user_count })
                  : uiText("admin_ui.en_delete_role_fbf06")
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
                {uiText("admin_ui.en_delete_f6fdb")}</Button>
            </Tooltip>
          </Space>
        ),
      },
    ],
    [uiText, ]
  );

  // Error state
  if (error) {
    return (
      <Alert closable
        type="error"
        message={uiText("admin_ui.en_error_loading_roles_69a09")}
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
          <h2 style={{ margin: 0 }}>{uiText("admin_ui.en_role_management_72579")}</h2>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={handleCreate}
          >
            {uiText("admin_ui.en_create_role_5bea0")}</Button>
        </Space>
      </div>

      {/* Info Alert */}
      <Alert
        type="info"
        message={uiText("admin_ui.en_roles_define_user_permissions_and_access_levels_in_85dd3")}
        description={uiText("admin_ui.en_users_are_assigned_to_roles_via_the_normalized_df1d1")}
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
          showTotal: (total) => uiText("admin_ui.en_total_role_s_beb85", { v0: total }),
        }}
        locale={{
          emptyText: emptyState ? (
            <div style={{ padding: '40px 0' }}>
              <p style={{ fontSize: 16, color: '#999' }}>{uiText("admin_ui.en_no_roles_found_951aa")}</p>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={handleCreate}
              >
                {uiText("admin_ui.en_create_first_role_0111b")}</Button>
            </div>
          ) : undefined,
        }}
      />

      {/* Create/Edit Modal */}
      <Modal
        title={editingRole ? uiText("admin_ui.en_edit_role_b075b") : uiText("admin_ui.en_create_role_5bea0")}
        open={isModalOpen}
        onCancel={() => {
          setIsModalOpen(false);
          setEditingRole(null);
          form.resetFields();
        }}
        onOk={handleSubmit}
        confirmLoading={creating || updating}
        okText={editingRole ? uiText("admin_ui.en_update_fb91e") : uiText("admin_ui.en_create_6e157")}
        width={600}
      >
        <Form
          form={form}
          layout="vertical"
          autoComplete="off"
        >
          <Form.Item
            label={uiText("admin_ui.en_role_name_a8b23")}
            name="name"
            rules={[
              { required: true, message: uiText("admin_ui.en_please_enter_a_role_name_c0e40") },
              { min: 2, message: uiText("admin_ui.en_role_name_must_be_at_least_2_characters_e9702") },
              { max: 50, message: uiText("admin_ui.en_role_name_cannot_exceed_50_characters_a6d11") },
              {
                pattern: /^[a-zA-Z0-9\s]+$/,
                message: uiText("admin_ui.en_role_name_can_only_contain_letters_numbers_and_a22eb"),
              },
            ]}
          >
            <Input
              placeholder={uiText("admin_ui.en_e_g_administrator_moderator_subscriber_dfaf6")}
              maxLength={50}
              showCount
            />
          </Form.Item>

          <Form.Item
            label={uiText("admin_ui.en_description_55f8e")}
            name="description"
            rules={[
              { max: 200, message: uiText("admin_ui.en_description_cannot_exceed_200_characters_de3a4") },
            ]}
          >
            <Input.TextArea
              placeholder={uiText("admin_ui.en_brief_description_of_this_role_s_purpose_3e299")}
              rows={3}
              maxLength={200}
              showCount
            />
          </Form.Item>

          <Form.Item
            label={uiText("admin_ui.en_active_status_93360")}
            name="is_active"
            valuePropName="checked"
            tooltip="Inactive roles cannot be assigned to new users"
          >
            <Switch
              checkedChildren={uiText("admin_ui.en_active_a733b")}
              unCheckedChildren={uiText("admin_ui.en_inactive_09af5")}
            />
          </Form.Item>

          {editingRole && editingRole.user_count > 0 && (
            <Alert closable
              type="info"
              message={uiText("admin_ui.en_this_role_is_currently_assigned_to_user_s_c873e", { v0: editingRole.user_count })}
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
