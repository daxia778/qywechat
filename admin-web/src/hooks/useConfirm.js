import { useState, useCallback, useRef } from 'react';

/**
 * Custom hook to manage confirm modal state.
 * Extracts the repeated pattern of showConfirm / confirmModal / onConfirm
 * found across ActivationCodesPage, EmployeesPage, OrdersPage, OrderDetailPage.
 *
 * Usage:
 *   const { modalProps, confirm } = useConfirm();
 *
 *   // Trigger:
 *   confirm({ title: '...', message: '...', type: 'danger', confirmText: '...' }, async () => { ... });
 *
 *   // Render:
 *   <ConfirmModal {...modalProps} />
 */
export function useConfirm() {
  const [state, setState] = useState({
    show: false,
    title: '',
    message: '',
    type: 'info',
    confirmText: '确认',
  });
  const actionRef = useRef(null);

  const confirm = useCallback((opts, action) => {
    actionRef.current = action;
    setState({ show: true, ...opts });
  }, []);

  const onConfirm = useCallback(() => {
    setState((s) => ({ ...s, show: false }));
    actionRef.current?.();
  }, []);

  const onCancel = useCallback(() => {
    setState((s) => ({ ...s, show: false }));
  }, []);

  return {
    modalProps: {
      visible: state.show,
      title: state.title,
      message: state.message,
      type: state.type,
      confirmText: state.confirmText,
      onConfirm,
      onCancel,
    },
    confirm,
  };
}
