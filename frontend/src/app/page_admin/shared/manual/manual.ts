import { Component, AfterViewInit, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../../auth.service';

@Component({
  selector: 'app-manual',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './manual.html',
  styleUrl: './manual.scss',
})
export class Manual implements AfterViewInit {
  protected authService = inject(AuthService);

  ngAfterViewInit(): void {
    window.scrollTo({ top: 0, behavior: 'instant' });
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.10 }
    );
    document.querySelectorAll('.animate').forEach(el => observer.observe(el));
  }
}
