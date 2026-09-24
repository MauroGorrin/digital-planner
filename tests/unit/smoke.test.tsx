import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

describe('toolchain', () => {
  it('ejecuta una aserción aritmética trivial', () => {
    expect(1 + 1).toBe(2);
  });

  it('renderiza y consulta un elemento con Testing Library y los matchers de jest-dom', () => {
    render(<p>planner de contenido</p>);
    expect(screen.getByText('planner de contenido')).toBeInTheDocument();
  });
});
