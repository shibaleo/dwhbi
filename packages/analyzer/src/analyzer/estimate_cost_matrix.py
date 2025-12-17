#!/usr/bin/env python3
"""Estimate cost matrix for Wasserstein distance using inverse optimal transport.

This script estimates the cost matrix C from (target, actual) pairs
using numerical optimization. The cost matrix captures how "easily"
time flows between categories.

Usage:
    python -m analyzer.estimate_cost_matrix

Output:
    - packages/transform/seeds/cost_matrix_time_categories.csv
    - packages/analyzer/output/cost_matrix_heatmap.png
"""

from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlparse

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import psycopg2
import seaborn as sns
from dotenv import load_dotenv
from scipy.optimize import linprog, minimize


def emd(p: np.ndarray, q: np.ndarray, C: np.ndarray) -> float:
    """Compute Earth Mover's Distance (Wasserstein-1) using linear programming.

    This is a pure scipy implementation that doesn't require POT.

    Args:
        p: Source distribution (sums to 1)
        q: Target distribution (sums to 1)
        C: Cost matrix (n x m)

    Returns:
        EMD value
    """
    n, m = len(p), len(q)

    # Flatten cost matrix for linear program
    c = C.flatten()

    # Equality constraints: sum over j of T[i,j] = p[i], sum over i of T[i,j] = q[j]
    # Build constraint matrix A_eq
    A_eq = np.zeros((n + m, n * m))

    # Row sum constraints (supply)
    for i in range(n):
        A_eq[i, i * m : (i + 1) * m] = 1

    # Column sum constraints (demand)
    for j in range(m):
        for i in range(n):
            A_eq[n + j, i * m + j] = 1

    b_eq = np.concatenate([p, q])

    # Solve linear program
    result = linprog(c, A_eq=A_eq, b_eq=b_eq, bounds=(0, None), method="highs")

    if result.success:
        return float(result.fun)
    else:
        # Fallback: return a large value
        return float("inf")

# Category order (must match dim_category_time_personal sort_order)
CATEGORIES = [
    "Vitals",
    "Sleep",
    "Exercise",
    "Overhead",
    "Work",
    "Education",
    "Creative",
    "Social",
    "Meta",
    "Pleasure",
]

# Coarse category groups for initial cost matrix
COARSE_GROUPS = {
    "Vitals": "Essentials",
    "Sleep": "Essentials",
    "Exercise": "Essentials",
    "Overhead": "Obligation",
    "Work": "Obligation",
    "Education": "Obligation",
    "Creative": "Leisure",
    "Social": "Leisure",
    "Meta": "Leisure",
    "Pleasure": "Leisure",
}


def load_paired_data() -> pd.DataFrame:
    """Load actual-target paired data from PostgreSQL."""
    # Load environment variables
    project_root = Path(__file__).parent.parent.parent.parent.parent
    load_dotenv(project_root / ".env")

    database_url = os.getenv("DIRECT_DATABASE_URL")
    if not database_url:
        raise ValueError("DIRECT_DATABASE_URL must be set in .env")

    # Parse database URL
    parsed = urlparse(database_url)
    conn = psycopg2.connect(
        host=parsed.hostname,
        port=parsed.port or 5432,
        user=parsed.username,
        password=parsed.password,
        dbname=parsed.path.lstrip("/"),
    )

    # Query paired data from analysis schema
    query = "SELECT * FROM analysis.daily_category_hours_paired"
    df = pd.read_sql(query, conn)
    conn.close()

    return df


def build_initial_cost_matrix(
    categories: list[str],
    groups: dict[str, str],
    same_group_cost: float = 1.0,
    diff_group_cost: float = 2.0,
) -> np.ndarray:
    """Build initial cost matrix based on category hierarchy.

    Same group (Essentials, Obligation, Leisure) -> lower cost
    Different group -> higher cost
    """
    k = len(categories)
    C = np.zeros((k, k))
    for i, cat_i in enumerate(categories):
        for j, cat_j in enumerate(categories):
            if i == j:
                C[i, j] = 0
            elif groups[cat_i] == groups[cat_j]:
                C[i, j] = same_group_cost
            else:
                C[i, j] = diff_group_cost
    return C


def extract_vectors(df: pd.DataFrame) -> list[tuple[np.ndarray, np.ndarray]]:
    """Extract (target, actual) vector pairs from DataFrame."""
    samples = []

    actual_cols = [f"actual_{cat.lower()}" for cat in CATEGORIES]
    target_cols = [f"target_{cat.lower()}" for cat in CATEGORIES]

    for _, row in df.iterrows():
        actual = np.array([row[col] for col in actual_cols], dtype=float)
        target = np.array([row[col] for col in target_cols], dtype=float)

        # Skip rows with zero total (incomplete days)
        if actual.sum() > 0 and target.sum() > 0:
            samples.append((target, actual))

    return samples


def estimate_cost_matrix(
    samples: list[tuple[np.ndarray, np.ndarray]],
    C_init: np.ndarray,
    reg: float = 0.1,
    verbose: bool = True,
    max_samples: int = 100,
    max_iter: int = 100,
) -> np.ndarray:
    """Estimate cost matrix using inverse optimal transport.

    Args:
        samples: List of (target, actual) vector pairs
        C_init: Initial cost matrix
        reg: Regularization parameter
        verbose: Print progress
        max_samples: Maximum number of samples to use (for speed)
        max_iter: Maximum number of optimizer iterations

    Returns:
        Estimated cost matrix (k x k)
    """
    k = len(C_init)

    # Subsample if too many samples (randomly select)
    if len(samples) > max_samples:
        np.random.seed(42)
        indices = np.random.choice(len(samples), max_samples, replace=False)
        samples = [samples[i] for i in indices]
        if verbose:
            print(f"Subsampled to {len(samples)} samples for efficiency")

    iteration_count = [0]

    def objective(C_flat: np.ndarray) -> float:
        C = C_flat.reshape(k, k)
        np.fill_diagonal(C, 0)

        loss = 0.0
        for target, actual in samples:
            # Normalize to probability distribution
            p = target / target.sum()
            q = actual / actual.sum()

            # EMD (Wasserstein-1 distance) using scipy
            loss += emd(p, q, C)

        # L2 regularization to avoid trivial solution
        loss += reg * np.sum(C**2)

        iteration_count[0] += 1
        if verbose and iteration_count[0] % 10 == 0:
            print(f"  Iteration {iteration_count[0]}: loss = {loss:.4f}")

        return loss

    if verbose:
        print(f"Starting optimization with {len(samples)} samples...")
        print(f"Initial cost matrix shape: {C_init.shape}")
        print(f"Max iterations: {max_iter}")

    result = minimize(
        objective,
        C_init.flatten(),
        method="L-BFGS-B",
        bounds=[(0, None)] * (k * k),
        options={"maxiter": max_iter, "disp": False},
    )

    if verbose:
        print(f"Optimization finished. Success: {result.success}")
        print(f"Final loss: {result.fun:.4f}")
        print(f"Total function evaluations: {iteration_count[0]}")

    C_optimal = result.x.reshape(k, k)

    # Normalize: max = 1
    if C_optimal.max() > 0:
        C_optimal = C_optimal / C_optimal.max()

    np.fill_diagonal(C_optimal, 0)

    return C_optimal


def save_cost_matrix_csv(C: np.ndarray, output_path: Path) -> None:
    """Save cost matrix as CSV seed file."""
    # Create DataFrame with from/to category names
    rows = []
    for i, from_cat in enumerate(CATEGORIES):
        for j, to_cat in enumerate(CATEGORIES):
            rows.append(
                {"from_category": from_cat, "to_category": to_cat, "cost": round(C[i, j], 6)}
            )

    df = pd.DataFrame(rows)
    df.to_csv(output_path, index=False)
    print(f"Saved cost matrix to {output_path}")


def plot_cost_matrix(C: np.ndarray, output_path: Path) -> None:
    """Plot cost matrix as heatmap."""
    plt.figure(figsize=(10, 8))
    sns.heatmap(
        C,
        xticklabels=CATEGORIES,
        yticklabels=CATEGORIES,
        annot=True,
        fmt=".2f",
        cmap="YlOrRd",
        vmin=0,
        vmax=1,
    )
    plt.xlabel("To Category")
    plt.ylabel("From Category")
    plt.title("Estimated Cost Matrix (Time Category Transitions)")
    plt.tight_layout()
    plt.savefig(output_path, dpi=150)
    plt.close()
    print(f"Saved heatmap to {output_path}")


def main() -> None:
    """Main entry point."""
    project_root = Path(__file__).parent.parent.parent.parent.parent

    # Create output directories
    seeds_dir = project_root / "packages" / "transform" / "seeds"
    output_dir = project_root / "packages" / "analyzer" / "output"
    output_dir.mkdir(parents=True, exist_ok=True)

    # Load data
    print("Loading paired data from Supabase...")
    df = load_paired_data()
    print(f"Loaded {len(df)} rows")

    # Extract vectors
    samples = extract_vectors(df)
    print(f"Extracted {len(samples)} valid (target, actual) pairs")

    if len(samples) == 0:
        print("No valid samples found. Exiting.")
        return

    # Build initial cost matrix from hierarchy
    C_init = build_initial_cost_matrix(CATEGORIES, COARSE_GROUPS)
    print("Built initial cost matrix from category hierarchy")

    # Estimate cost matrix
    C_optimal = estimate_cost_matrix(samples, C_init, reg=0.1, verbose=True)

    # Save results
    save_cost_matrix_csv(C_optimal, seeds_dir / "cost_matrix_time_categories.csv")
    plot_cost_matrix(C_optimal, output_dir / "cost_matrix_heatmap.png")

    # Print summary
    print("\nEstimated Cost Matrix:")
    print(pd.DataFrame(C_optimal, index=CATEGORIES, columns=CATEGORIES).round(3))


if __name__ == "__main__":
    main()
