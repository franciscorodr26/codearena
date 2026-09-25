import { useState, useCallback, useMemo } from 'react';

/**
 * useFormValidation - Hook for form validation with real-time feedback
 *
 * @param {Object} initialValues - Initial form values
 * @param {Object} validationRules - Validation rules for each field
 * @returns {Object} Form state and helpers
 *
 * @example
 * const { values, errors, touched, handleChange, handleBlur, isValid, validate } = useFormValidation(
 *   { email: '', password: '' },
 *   {
 *     email: [validators.required('Email is required'), validators.email()],
 *     password: [validators.required(), validators.minLength(8)]
 *   }
 * );
 */
export function useFormValidation(initialValues = {}, validationRules = {}) {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Validate a single field
  const validateField = useCallback((name, value) => {
    const rules = validationRules[name];
    if (!rules) return null;

    for (const rule of rules) {
      const error = rule(value, values);
      if (error) return error;
    }
    return null;
  }, [validationRules, values]);

  // Validate all fields
  const validateAll = useCallback(() => {
    const newErrors = {};
    let isValid = true;

    for (const [name, rules] of Object.entries(validationRules)) {
      const error = validateField(name, values[name]);
      if (error) {
        newErrors[name] = error;
        isValid = false;
      }
    }

    setErrors(newErrors);
    return isValid;
  }, [validateField, validationRules, values]);

  // Handle input change
  const handleChange = useCallback((e) => {
    const { name, value, type, checked } = e.target;
    const newValue = type === 'checkbox' ? checked : value;

    setValues(prev => ({ ...prev, [name]: newValue }));

    // Clear error when user starts typing
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: null }));
    }
  }, [errors]);

  // Handle input blur - validate on blur
  const handleBlur = useCallback((e) => {
    const { name, value } = e.target;
    setTouched(prev => ({ ...prev, [name]: true }));

    const error = validateField(name, value);
    setErrors(prev => ({ ...prev, [name]: error }));
  }, [validateField]);

  // Set a specific field value
  const setValue = useCallback((name, value) => {
    setValues(prev => ({ ...prev, [name]: value }));
  }, []);

  // Set a specific field error
  const setError = useCallback((name, error) => {
    setErrors(prev => ({ ...prev, [name]: error }));
  }, []);

  // Reset form
  const reset = useCallback(() => {
    setValues(initialValues);
    setErrors({});
    setTouched({});
    setIsSubmitting(false);
  }, [initialValues]);

  // Get field props for easy binding
  const getFieldProps = useCallback((name) => ({
    name,
    value: values[name] || '',
    onChange: handleChange,
    onBlur: handleBlur,
    error: touched[name] ? errors[name] : null,
    success: touched[name] && !errors[name] && values[name] ? true : false,
  }), [values, handleChange, handleBlur, touched, errors]);

  // Check if form is valid
  const isValid = useMemo(() => {
    return Object.keys(validationRules).every(name => !validateField(name, values[name]));
  }, [validationRules, validateField, values]);

  // Handle form submission
  const handleSubmit = useCallback((onSubmit) => async (e) => {
    e?.preventDefault();
    setIsSubmitting(true);

    // Mark all fields as touched
    const allTouched = Object.keys(validationRules).reduce((acc, name) => {
      acc[name] = true;
      return acc;
    }, {});
    setTouched(allTouched);

    if (validateAll()) {
      try {
        await onSubmit(values);
      } catch (err) {
        // Allow onSubmit to throw validation errors
        if (err.fieldErrors) {
          setErrors(err.fieldErrors);
        }
      }
    }
    setIsSubmitting(false);
  }, [validateAll, validationRules, values]);

  return {
    values,
    errors,
    touched,
    isValid,
    isSubmitting,
    handleChange,
    handleBlur,
    handleSubmit,
    setValue,
    setError,
    setValues,
    setErrors,
    reset,
    getFieldProps,
    validateField,
    validateAll,
  };
}

// Common validators
export const validators = {
  required: (message = 'This field is required') => (value) => {
    if (!value || (typeof value === 'string' && !value.trim())) {
      return message;
    }
    return null;
  },

  email: (message = 'Please enter a valid email') => (value) => {
    if (!value) return null;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) {
      return message;
    }
    return null;
  },

  minLength: (min, message) => (value) => {
    if (!value) return null;
    if (value.length < min) {
      return message || `Must be at least ${min} characters`;
    }
    return null;
  },

  maxLength: (max, message) => (value) => {
    if (!value) return null;
    if (value.length > max) {
      return message || `Must be no more than ${max} characters`;
    }
    return null;
  },

  pattern: (regex, message = 'Invalid format') => (value) => {
    if (!value) return null;
    if (!regex.test(value)) {
      return message;
    }
    return null;
  },

  matches: (fieldName, message) => (value, allValues) => {
    if (!value) return null;
    if (value !== allValues[fieldName]) {
      return message || `Must match ${fieldName}`;
    }
    return null;
  },

  username: (message = 'Username can only contain letters, numbers, and underscores') => (value) => {
    if (!value) return null;
    const usernameRegex = /^[a-zA-Z0-9_]+$/;
    if (!usernameRegex.test(value)) {
      return message;
    }
    return null;
  },

  password: (message) => (value) => {
    if (!value) return null;
    const hasMinLength = value.length >= 8;
    const hasUppercase = /[A-Z]/.test(value);
    const hasLowercase = /[a-z]/.test(value);
    const hasNumber = /[0-9]/.test(value);

    if (!hasMinLength || !hasUppercase || !hasLowercase || !hasNumber) {
      return message || 'Password must be 8+ characters with uppercase, lowercase, and number';
    }
    return null;
  },

  url: (message = 'Please enter a valid URL') => (value) => {
    if (!value) return null;
    try {
      new URL(value);
      return null;
    } catch {
      return message;
    }
  },

  number: (message = 'Must be a number') => (value) => {
    if (!value) return null;
    if (isNaN(Number(value))) {
      return message;
    }
    return null;
  },

  min: (minValue, message) => (value) => {
    if (!value) return null;
    if (Number(value) < minValue) {
      return message || `Must be at least ${minValue}`;
    }
    return null;
  },

  max: (maxValue, message) => (value) => {
    if (!value) return null;
    if (Number(value) > maxValue) {
      return message || `Must be no more than ${maxValue}`;
    }
    return null;
  },

  custom: (validator) => validator,
};

// Password strength calculator
export function getPasswordStrength(password) {
  if (!password) return { score: 0, label: '', color: '' };

  let score = 0;
  const checks = {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
    longLength: password.length >= 12,
  };

  if (checks.length) score++;
  if (checks.uppercase) score++;
  if (checks.lowercase) score++;
  if (checks.number) score++;
  if (checks.special) score++;
  if (checks.longLength) score++;

  const levels = [
    { score: 0, label: 'Very Weak', color: 'error' },
    { score: 1, label: 'Weak', color: 'error' },
    { score: 2, label: 'Fair', color: 'warning' },
    { score: 3, label: 'Good', color: 'warning' },
    { score: 4, label: 'Strong', color: 'success' },
    { score: 5, label: 'Very Strong', color: 'success' },
    { score: 6, label: 'Excellent', color: 'success' },
  ];

  const level = levels[Math.min(score, levels.length - 1)];
  return { score, ...level, checks };
}

export default useFormValidation;
